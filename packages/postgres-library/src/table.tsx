// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<Table>` (function) + `<Column>` / `<Index>` markers + the underlying
// `TableResource` (defineComponent).
//
// What DB-X adds on top of DB-X's `<Table>`:
//   - `description` on Table/Column/Index — surfaced to the AI tools.
//   - `from="<oldName>"` on `<Column>`: explicit rename hint. Without it
//     the diff can't tell rename from drop+add. With it we emit
//     `ALTER TABLE ... RENAME COLUMN` cleanly.
//
// TODO (v0.0 follow-up, see GOALS.md):
//   - Surface destructive changes (DROP COLUMN, TYPE narrowing) with a
//     `!` marker and a --allow-destructive gate. (issue #2)

import { type AnyElement, type Child, type PlanAction, defineComponent } from '@db-x/runtime'
import { findPostgresParent, requirePostgresParent, runSql } from './exec.js'

// ─────────────────────────────────────────────────────────────────────────────
//  <Column> + <Index> — markers absorbed by <Table> at render time
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnSpec {
	name: string
	/**
	 * Previous JSX-side name of this column. When set, the diff emits
	 * `ALTER TABLE ... RENAME COLUMN "<from>" TO "<name>"` instead of
	 * adding a fresh column. Required because rename-vs-drop+add is
	 * indistinguishable from JSX alone.
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
	/** Connection user. Defaults to the parent `<Postgres user>`. */
	user?: string
	/** Connection database. Defaults to the parent `<Postgres database>`. */
	database?: string
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
			user={props.user}
			database={props.database}
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
	user?: string
	database?: string
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

// Sentinel `type` for columns recovered from pre-rich-diff state (name-only).
// Attribute diffs are suppressed for these — we only know the name.
// ponytail: tolerate one legacy state shape; drop this once alpha state resets.
const UNKNOWN_TYPE = '__db_x_unknown__'

function normalizePriorColumns(raw: unknown): ColumnSpec[] {
	if (!Array.isArray(raw)) return []
	return raw.map((c) =>
		typeof c === 'string' ? { name: c, type: UNKNOWN_TYPE } : (c as ColumnSpec)
	)
}

function normalizePriorIndexes(raw: unknown): IndexSpec[] {
	return Array.isArray(raw) ? (raw as IndexSpec[]) : []
}

const TableResource = defineComponent<TableResourceProps, TableResourceOutputs>({
	kind: '@db-x/postgres-library:table',
	apply: async (props, ctx, prior) => {
		const parent = requirePostgresParent(ctx, 'Table')
		const user = props.user ?? parent.user
		const database = props.database ?? parent.database

		if (!prior) {
			// First apply: stable columns can't carry a `from` (there's nothing
			// to rename from). Reject early so an authoring mistake surfaces.
			const ghostRenames = props.columns.filter((c) => c.from)
			if (ghostRenames.length > 0) {
				const names = ghostRenames.map((c) => c.name).join(', ')
				throw new Error(
					`<Table name="${props.name}">: column(s) ${names} use \`from=\` on first apply — there is no prior table to rename from. Drop \`from\` or apply a baseline first.`
				)
			}
			const createSql = buildCreateTable(props)
			ctx.log.info(`Creating table ${props.name}`)
			await runSql(parent, user, database, createSql, ctx)
		} else {
			const diff = diffTable(props.name, props.columns, props.indexes, {
				columns: normalizePriorColumns(prior.outputs.columns),
				indexes: normalizePriorIndexes(prior.outputs.indexes),
			})
			if (diff.sql.length === 0) {
				ctx.log.info(`Table ${props.name} unchanged`)
			} else {
				ctx.log.info(`Table ${props.name}: ${summarize(diff)}`)
				await runSql(parent, user, database, diff.sql.join(';\n'), ctx)
			}
		}

		// Index creates — always idempotent via IF NOT EXISTS, so safe to re-run.
		// (Removed indexes are dropped via diffTable above.)
		for (const idx of props.indexes) {
			await runSql(parent, user, database, buildCreateIndex(props.name, idx), ctx)
		}

		return { name: props.name, columns: props.columns, indexes: props.indexes }
	},
	destroy: async (state, ctx) => {
		const parent = findPostgresParent(ctx)
		if (!parent) {
			ctx.log.warn(`Parent postgres missing; skipping drop of table ${state.outputs.name}`)
			return
		}
		const user = state.props.user ?? parent.user
		const database = state.props.database ?? parent.database
		ctx.log.info(`Dropping table ${state.outputs.name}`)
		try {
			await runSql(
				parent,
				user,
				database,
				`DROP TABLE IF EXISTS "${state.outputs.name}" CASCADE`,
				ctx
			)
		} catch (err) {
			ctx.log.warn(`drop failed: ${(err as Error).message}`)
		}
	},
	// Pure diff at plan time so `preview` / `apply` can classify destructive
	// changes (ALTER TYPE, DROP INDEX/CONSTRAINT) before any SQL runs. Compares
	// desired columns/indexes against the last-applied outputs.
	plan: (props, prior): PlanAction => {
		if (!prior) return { type: 'create' }
		// Deliberately NOT short-circuiting on `props === prior.props`: refresh
		// writes observed reality into `outputs`, so identical props can still
		// need work (a column dropped out of band). Diffing against outputs is
		// what makes `refresh` -> `preview` -> `apply` reconcile drift at all.

		const diff = diffTable(props.name, props.columns, props.indexes, {
			columns: normalizePriorColumns(prior.outputs.columns),
			indexes: normalizePriorIndexes(prior.outputs.indexes),
		})
		if (diff.sql.length === 0) {
			// Nothing to run against the database; only persist if props moved
			// (a changed `description`, say).
			return JSON.stringify(props) === JSON.stringify(prior.props)
				? { type: 'no-op' }
				: { type: 'update', reason: 'props changed' }
		}
		const reason = summarize(diff)
		return diff.destructive.length > 0
			? { type: 'update', reason, destructive: diff.destructive, details: diff.sql }
			: { type: 'update', reason, details: diff.sql }
	},
})

// ─────────────────────────────────────────────────────────────────────────────
//  SQL builders — exported for tests + future rich-diff work
// ─────────────────────────────────────────────────────────────────────────────

export function buildCreateTable(props: { name: string; columns: ColumnSpec[] }): string {
	const colSqls = props.columns.map(columnSql)
	return `CREATE TABLE IF NOT EXISTS "${props.name}" (\n  ${colSqls.join(',\n  ')}\n)`
}

// The bare words Postgres accepts as a DEFAULT without quotes.
const BARE_DEFAULTS = new Set([
	'null',
	'true',
	'false',
	'current_timestamp',
	'current_date',
	'current_time',
	'current_user',
	'session_user',
	'localtimestamp',
])

/**
 * Validate a `DEFAULT` clause and return it, or refuse.
 *
 * `default` is raw SQL, so a literal string has to carry its own quotes:
 * `default="'blue'"`, not `default="blue"`. Unquoted, Postgres reads it as a
 * column reference and fails at apply time with `column "blue" does not
 * exist` — after the plan was rendered and approved. Refusing here keeps a
 * statement that cannot run out of the plan, and names the replacement.
 *
 * Unlike SQLite this only validates; Postgres accepts a bare `now()` as a
 * default, so there is nothing to rewrite.
 */
function checkDefault(name: string, value: string): string {
	const trimmed = value.trim()
	if (trimmed === '') {
		throw new Error(
			`<Column name="${name}" default="">: an empty default is not valid SQL. Use default="''" for an empty string, or omit the prop for no default.`
		)
	}
	const ok =
		/^-?\d+(\.\d+)?$/.test(trimmed) ||
		/^'([^']|'')*'(::\w+)?$/.test(trimmed) ||
		BARE_DEFAULTS.has(trimmed.toLowerCase()) ||
		trimmed.includes('(')
	if (!ok) {
		throw new Error(
			`<Column name="${name}" default="${value}">: this would emit DEFAULT ${trimmed}, which Postgres reads as a column reference and rejects — \`column "${trimmed}" does not exist\`. ` +
				`\`default\` is raw SQL, so a literal string carries its own quotes: default="'${trimmed.replace(/'/g, "''")}'".`
		)
	}
	return trimmed
}

export function columnSql(c: ColumnSpec): string {
	const parts = [`"${c.name}"`, c.type]
	if (c.primaryKey) parts.push('PRIMARY KEY')
	if (c.notNull && !c.primaryKey) parts.push('NOT NULL')
	if (c.unique && !c.primaryKey) parts.push('UNIQUE')
	if (c.default !== undefined) parts.push(`DEFAULT ${checkDefault(c.name, c.default)}`)
	return parts.join(' ')
}

export function buildCreateIndex(tableName: string, idx: IndexSpec): string {
	const unique = idx.unique ? 'UNIQUE ' : ''
	const cols = idx.columns.map((c) => `"${c}"`).join(', ')
	return `CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${tableName}" (${cols})`
}

/**
 * Pure diff function — exported so the upcoming `db-x preview` /
 * `db-x mcp` surfaces can render the SQL without running it.
 */
export interface TableDiff {
	renames: Array<{ from: string; to: string }>
	additions: ColumnSpec[]
	/** In-place column attribute changes, keyed by the (post-rename) name. */
	alterations: Array<{ column: string; sql: string[] }>
	/** Names of indexes present in prior state but no longer declared. */
	droppedIndexes: string[]
	/** Names of columns present in prior state but no longer declared. */
	droppedColumns: string[]
	/** SQL statements in apply order. */
	sql: string[]
	/**
	 * The subset of `sql` that is destructive — drops an object or coerces
	 * existing data (ALTER TYPE, DROP INDEX/CONSTRAINT/COLUMN). Metadata-only
	 * DROPs (DROP DEFAULT / DROP NOT NULL) are not included.
	 */
	destructive: string[]
}

/** One-line diff summary, shared by the apply log and the plan reason. */
function summarize(diff: TableDiff): string {
	return (
		`${diff.renames.length} rename(s), ${diff.additions.length} addition(s), ` +
		`${diff.alterations.length} alter(s), ${diff.droppedIndexes.length} index drop(s), ` +
		`${diff.droppedColumns.length} column drop(s)`
	)
}

/** A statement that drops a schema object or can lose/coerce existing data. */
function isDestructiveSql(sql: string): boolean {
	return (
		/ TYPE /.test(sql) ||
		sql.includes('DROP INDEX') ||
		sql.includes('DROP CONSTRAINT') ||
		sql.includes('DROP COLUMN')
	)
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

	// 3. Alterations: columns that map to a prior column (same name or via a
	//    rename) whose attributes changed.
	const alterations: Array<{ column: string; sql: string[] }> = []
	for (const c of next) {
		const priorSpec = renameFrom.has(c.name)
			? priorByName.get(renameFrom.get(c.name) as string)
			: priorByName.get(c.name)
		if (!priorSpec) continue
		const stmts = alterColumnSql(tableName, c, priorSpec)
		if (stmts.length > 0) alterations.push({ column: c.name, sql: stmts })
	}

	// 4. Removed indexes.
	const nextIndexNames = new Set(nextIndexes.map((i) => i.name))
	const droppedIndexes = prior.indexes.filter((i) => !nextIndexNames.has(i.name)).map((i) => i.name)

	// 5. Removed columns — in prior state, no longer declared, and not the
	//    source side of a rename (that column lives on under its new name).
	const nextNames = new Set(next.map((c) => c.name))
	const renameSources = new Set(renames.map((c) => c.from as string))
	const droppedColumns = prior.columns
		.filter((c) => !nextNames.has(c.name) && !renameSources.has(c.name))
		.map((c) => c.name)

	const sql: string[] = [
		...renames.map((c) => `ALTER TABLE "${tableName}" RENAME COLUMN "${c.from}" TO "${c.name}"`),
		...additions.map((c) => `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS ${columnSql(c)}`),
		...alterations.flatMap((a) => a.sql),
		...droppedIndexes.map((n) => `DROP INDEX IF EXISTS "${n}"`),
		...droppedColumns.map((n) => `ALTER TABLE "${tableName}" DROP COLUMN IF EXISTS "${n}"`),
	]

	return {
		renames: renames.map((c) => ({ from: c.from as string, to: c.name })),
		additions,
		alterations,
		droppedIndexes,
		droppedColumns,
		sql,
		destructive: sql.filter(isDestructiveSql),
	}
}

/**
 * ALTER statements for a single column whose attributes drifted from `prior`.
 * PRIMARY KEY columns skip NOT NULL / UNIQUE diffs — the PK constraint already
 * implies both. Legacy (name-only) prior specs suppress all attribute diffs.
 */
function alterColumnSql(tableName: string, next: ColumnSpec, prior: ColumnSpec): string[] {
	if (prior.type === UNKNOWN_TYPE) return []
	const t = `ALTER TABLE "${tableName}"`
	const col = `"${next.name}"`
	const stmts: string[] = []

	if (next.type !== prior.type) stmts.push(`${t} ALTER COLUMN ${col} TYPE ${next.type}`)

	if ((next.default ?? undefined) !== (prior.default ?? undefined)) {
		stmts.push(
			next.default !== undefined
				? `${t} ALTER COLUMN ${col} SET DEFAULT ${checkDefault(next.name, next.default)}`
				: `${t} ALTER COLUMN ${col} DROP DEFAULT`
		)
	}

	const pk = next.primaryKey || prior.primaryKey
	if (!pk) {
		if (!!next.notNull !== !!prior.notNull) {
			stmts.push(`${t} ALTER COLUMN ${col} ${next.notNull ? 'SET' : 'DROP'} NOT NULL`)
		}
		if (!!next.unique !== !!prior.unique) {
			const cons = `"${tableName}_${next.name}_key"`
			stmts.push(
				next.unique
					? `${t} ADD CONSTRAINT ${cons} UNIQUE (${col})`
					: `${t} DROP CONSTRAINT IF EXISTS ${cons}`
			)
		}
	}

	return stmts
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
