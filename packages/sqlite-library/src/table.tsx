// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<Table>` (function) + `<Column>` / `<Index>` markers + the underlying
// `TableResource` (defineComponent) — SQLite DDL.
//
// Mirrors @db-x/postgres-library's table.tsx, with SQLite's constraints:
//   - No `ALTER COLUMN` at all. Type / default / NOT NULL changes require a
//     create-copy-drop-rename table rebuild, which is NOT implemented yet
//     (ponytail: deferred to a follow-up issue — the todo demo only ever
//     creates tables, so this ceiling doesn't block it). We throw instead of
//     emitting invalid SQL.
//   - `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` clause in SQLite.
//   - `serial` + `primaryKey` becomes `INTEGER PRIMARY KEY AUTOINCREMENT`.

import { type AnyElement, type Child, type PlanAction, defineComponent } from '@db-x/runtime'
import { findSqliteParent, requireSqliteParent, runSql } from './exec.js'

// ─────────────────────────────────────────────────────────────────────────────
//  <Column> + <Index> — markers absorbed by <Table> at render time
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnSpec {
	name: string
	/**
	 * Previous JSX-side name of this column. When set, the diff emits
	 * `ALTER TABLE ... RENAME COLUMN "<from>" TO "<name>"` instead of
	 * adding a fresh column.
	 */
	from?: string
	type: string
	primaryKey?: boolean
	notNull?: boolean
	unique?: boolean
	default?: string
	/** AI-readable purpose for this column. */
	description?: string
}

export function Column(_props: ColumnSpec): never {
	throw new Error('<Column> must be a child of <Table>.')
}

export interface IndexSpec {
	name: string
	columns: string[]
	unique?: boolean
	/** AI-readable purpose for this index. */
	description?: string
}

export function Index(_props: IndexSpec): never {
	throw new Error('<Index> must be a child of <Table>.')
}

// ─────────────────────────────────────────────────────────────────────────────
//  <Table> — function component that returns <TableResource>
// ─────────────────────────────────────────────────────────────────────────────

export interface TableProps {
	name: string
	/** AI-readable purpose for this table. */
	description?: string
	children?: Child | Child[]
}

export function Table(props: TableProps) {
	const columns: ColumnSpec[] = []
	const indexes: IndexSpec[] = []
	for (const child of asArray(props.children)) {
		if (!isElement(child)) continue
		if (child.type === Column) {
			columns.push(child.props as unknown as ColumnSpec)
		} else if (child.type === Index) {
			indexes.push(child.props as unknown as IndexSpec)
		}
	}
	if (columns.length === 0) {
		throw new Error(`<Table name="${props.name}"> must contain at least one <Column>.`)
	}
	return (
		<TableResource
			name={props.name}
			description={props.description}
			columns={columns}
			indexes={indexes}
		/>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
//  TableResource — the diff'd, applied, destroyed resource
// ─────────────────────────────────────────────────────────────────────────────

interface TableResourceProps {
	name: string
	description?: string
	columns: ColumnSpec[]
	indexes: IndexSpec[]
}

interface TableResourceOutputs {
	name: string
	/** Full column specs *after* any renames, in declaration order. */
	columns: ColumnSpec[]
	/** Index specs, so the next diff can detect removed indexes. */
	indexes: IndexSpec[]
	[key: string]: unknown
}

function normalizePriorColumns(raw: unknown): ColumnSpec[] {
	return Array.isArray(raw) ? (raw as ColumnSpec[]) : []
}

function normalizePriorIndexes(raw: unknown): IndexSpec[] {
	return Array.isArray(raw) ? (raw as IndexSpec[]) : []
}

const TableResource = defineComponent<TableResourceProps, TableResourceOutputs>({
	kind: '@db-x/sqlite-library:table',
	apply: async (props, ctx, prior) => {
		const parent = requireSqliteParent(ctx, 'Table')

		if (!prior) {
			const ghostRenames = props.columns.filter((c) => c.from)
			if (ghostRenames.length > 0) {
				const names = ghostRenames.map((c) => c.name).join(', ')
				throw new Error(
					`<Table name="${props.name}">: column(s) ${names} use \`from=\` on first apply — there is no prior table to rename from. Drop \`from\` or apply a baseline first.`
				)
			}
			const createSql = buildCreateTable(props)
			ctx.log.info(`Creating table ${props.name}`)
			await runSql(parent, createSql, ctx)
		} else {
			const diff = diffTable(props.name, props.columns, props.indexes, {
				columns: normalizePriorColumns(prior.outputs.columns),
				indexes: normalizePriorIndexes(prior.outputs.indexes),
			})
			if (diff.sql.length === 0) {
				ctx.log.info(`Table ${props.name} unchanged`)
			} else {
				ctx.log.info(
					`Table ${props.name}: ${diff.renames.length} rename(s), ${diff.additions.length} addition(s), ${diff.droppedIndexes.length} index drop(s)`
				)
				await runSql(parent, diff.sql.join(';\n'), ctx)
			}
		}

		// Index creates — always idempotent via IF NOT EXISTS, so safe to re-run.
		// (Removed indexes are dropped via diffTable above.)
		for (const idx of props.indexes) {
			await runSql(parent, buildCreateIndex(props.name, idx), ctx)
		}

		return { name: props.name, columns: props.columns, indexes: props.indexes }
	},
	destroy: async (state, ctx) => {
		const parent = findSqliteParent(ctx)
		if (!parent) {
			ctx.log.warn(`Parent sqlite missing; skipping drop of table ${state.outputs.name}`)
			return
		}
		ctx.log.info(`Dropping table ${state.outputs.name}`)
		try {
			await runSql(parent, `DROP TABLE IF EXISTS "${state.outputs.name}"`, ctx)
		} catch (err) {
			ctx.log.warn(`drop failed: ${(err as Error).message}`)
		}
	},
	// Pure diff at plan time so `preview` / `apply` can classify destructive
	// changes (DROP INDEX) before any SQL runs. Compares desired columns/
	// indexes against the last-applied outputs. Throws if the diff would
	// require an unsupported SQLite ALTER COLUMN.
	plan: (props, prior): PlanAction => {
		if (!prior) return { type: 'create' }
		if (JSON.stringify(props) === JSON.stringify(prior.props)) return { type: 'no-op' }
		const diff = diffTable(props.name, props.columns, props.indexes, {
			columns: normalizePriorColumns(prior.outputs.columns),
			indexes: normalizePriorIndexes(prior.outputs.indexes),
		})
		const reason =
			diff.sql.length > 0
				? `${diff.renames.length} rename(s), ${diff.additions.length} addition(s), ${diff.droppedIndexes.length} index drop(s)`
				: 'props changed'
		return diff.destructive.length > 0
			? { type: 'update', reason, destructive: diff.destructive }
			: { type: 'update', reason }
	},
})

// ─────────────────────────────────────────────────────────────────────────────
//  SQL builders — exported for tests + future rich-diff work
// ─────────────────────────────────────────────────────────────────────────────

/** Case-insensitive friendly aliases for types that aren't native SQLite storage classes. */
const TYPE_ALIASES: Record<string, string> = {
	serial: 'INTEGER',
	boolean: 'INTEGER',
	bool: 'INTEGER',
	uuid: 'TEXT',
	timestamptz: 'TEXT',
	timestamp: 'TEXT',
	int: 'INTEGER',
	citext: 'TEXT',
}

function resolveType(type: string): string {
	return TYPE_ALIASES[type.toLowerCase()] ?? type
}

/**
 * SQLite has no `SET DEFAULT <expr>` grammar for literals vs expressions —
 * literals (numbers, quoted strings) are written as-is; anything else
 * (a function call, `CURRENT_TIMESTAMP`, …) must be a parenthesized
 * expression. Values already wrapped in parens pass through unchanged.
 */
function formatDefault(value: string): string {
	const trimmed = value.trim()
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
	if (/^'.*'$/.test(trimmed)) return trimmed
	if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed
	return `(${trimmed})`
}

export function buildCreateTable(props: { name: string; columns: ColumnSpec[] }): string {
	const colSqls = props.columns.map(columnSql)
	return `CREATE TABLE IF NOT EXISTS "${props.name}" (\n  ${colSqls.join(',\n  ')}\n)`
}

export function columnSql(c: ColumnSpec): string {
	const isSerialPk = c.type.toLowerCase() === 'serial' && c.primaryKey
	const parts = [`"${c.name}"`]
	if (isSerialPk) {
		parts.push('INTEGER PRIMARY KEY AUTOINCREMENT')
	} else {
		parts.push(resolveType(c.type))
		if (c.primaryKey) parts.push('PRIMARY KEY')
	}
	if (c.notNull && !c.primaryKey) parts.push('NOT NULL')
	if (c.unique && !c.primaryKey) parts.push('UNIQUE')
	if (c.default !== undefined) parts.push(`DEFAULT ${formatDefault(c.default)}`)
	return parts.join(' ')
}

export function buildCreateIndex(tableName: string, idx: IndexSpec): string {
	const unique = idx.unique ? 'UNIQUE ' : ''
	const cols = idx.columns.map((c) => `"${c}"`).join(', ')
	return `CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${tableName}" (${cols})`
}

/**
 * Pure diff function — exported so `db-x preview` / `db-x mcp` can render
 * the SQL without running it.
 */
export interface TableDiff {
	renames: Array<{ from: string; to: string }>
	additions: ColumnSpec[]
	/** Names of indexes present in prior state but no longer declared. */
	droppedIndexes: string[]
	/** SQL statements in apply order. */
	sql: string[]
	/**
	 * The subset of `sql` that is destructive — drops a schema object.
	 */
	destructive: string[]
}

/** A statement that drops a schema object. */
function isDestructiveSql(sql: string): boolean {
	return sql.includes('DROP TABLE') || sql.includes('DROP INDEX') || sql.includes('DROP COLUMN')
}

export function diffTable(
	tableName: string,
	next: ColumnSpec[],
	nextIndexes: IndexSpec[],
	prior: { columns: ColumnSpec[]; indexes: IndexSpec[] }
): TableDiff {
	const priorByName = new Map(prior.columns.map((c) => [c.name, c]))

	// 1. Renames: a column with `from` whose `from` exists in the prior table
	//    and whose new `name` does NOT yet exist.
	const renames = next.filter(
		(c) =>
			typeof c.from === 'string' &&
			c.from.length > 0 &&
			priorByName.has(c.from) &&
			!priorByName.has(c.name)
	)
	const renameFrom = new Map(renames.map((c) => [c.name, c.from as string]))
	const renamedNewNames = new Set(renames.map((c) => c.name))

	// 2. Additions: columns we've never seen before, excluding renames.
	const additions = next.filter(
		(c) => !priorByName.has(c.name) && !renamedNewNames.has(c.name) && !c.from
	)

	// 3. Attribute changes: SQLite can't ALTER COLUMN at all. Any column that
	//    maps to a prior column (same name or via rename) whose type/default/
	//    notNull/unique changed needs a table rebuild — not supported yet.
	for (const c of next) {
		const priorSpec = renameFrom.has(c.name)
			? priorByName.get(renameFrom.get(c.name) as string)
			: priorByName.get(c.name)
		if (!priorSpec) continue
		assertNoUnsupportedAlter(tableName, c, priorSpec)
	}

	// 4. Removed indexes.
	const nextIndexNames = new Set(nextIndexes.map((i) => i.name))
	const droppedIndexes = prior.indexes.filter((i) => !nextIndexNames.has(i.name)).map((i) => i.name)

	const sql: string[] = [
		...renames.map((c) => `ALTER TABLE "${tableName}" RENAME COLUMN "${c.from}" TO "${c.name}"`),
		// SQLite's `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` clause.
		...additions.map((c) => `ALTER TABLE "${tableName}" ADD COLUMN ${columnSql(c)}`),
		...droppedIndexes.map((n) => `DROP INDEX IF EXISTS "${n}"`),
	]

	return {
		renames: renames.map((c) => ({ from: c.from as string, to: c.name })),
		additions,
		droppedIndexes,
		sql,
		destructive: sql.filter(isDestructiveSql),
	}
}

/**
 * Throws when `next` differs from `prior` in a way SQLite cannot express as
 * an `ALTER TABLE` statement (type, default, or NOT NULL). PRIMARY KEY
 * columns skip NOT NULL / UNIQUE diffs, same as Postgres — the PK
 * constraint already implies both.
 */
function assertNoUnsupportedAlter(tableName: string, next: ColumnSpec, prior: ColumnSpec): void {
	const fail = (what: string): never => {
		throw new Error(
			`SQLite can't ALTER COLUMN "${next.name}" on table "${tableName}" (${what}); needs a table rebuild — not supported yet.`
		)
	}

	if (resolveType(next.type) !== resolveType(prior.type)) fail('type change')
	if ((next.default ?? undefined) !== (prior.default ?? undefined)) fail('default change')

	const pk = next.primaryKey || prior.primaryKey
	if (!pk) {
		if (!!next.notNull !== !!prior.notNull) fail('NOT NULL change')
		if (!!next.unique !== !!prior.unique) fail('UNIQUE constraint change')
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  JSX child utilities
// ─────────────────────────────────────────────────────────────────────────────

function asArray(value: Child | Child[] | undefined): Child[] {
	if (value === undefined || value === null) return []
	return Array.isArray(value) ? value : [value]
}

function isElement(value: Child): value is AnyElement {
	return (
		value !== null &&
		typeof value === 'object' &&
		'$$typeof' in value &&
		'type' in value &&
		'props' in value
	)
}
