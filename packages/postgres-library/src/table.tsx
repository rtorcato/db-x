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
//   - Detect type / default / NOT NULL / UNIQUE changes → ALTER COLUMN.
//   - Detect removed indexes → DROP INDEX IF EXISTS.
//   - Surface destructive changes (DROP COLUMN, TYPE narrowing) with a
//     `!` marker and a --allow-destructive gate.

import { type AnyElement, type Child, defineComponent } from '@db-x/runtime'
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
	/** Resolved column names *after* any renames, in declaration order. */
	columns: string[]
	[key: string]: unknown
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
			const priorCols = new Set(prior.outputs.columns)

			// 1. Renames first. A column with `from` whose `from` exists in the
			//    prior table and whose new `name` does NOT yet exist.
			const renames = props.columns.filter(
				(c) =>
					typeof c.from === 'string' &&
					c.from.length > 0 &&
					priorCols.has(c.from) &&
					!priorCols.has(c.name)
			)

			// 2. Additions: columns we've never seen before, ignoring those
			//    that are actually renames.
			const renamedNewNames = new Set(renames.map((c) => c.name))
			const additions = props.columns.filter(
				(c) => !priorCols.has(c.name) && !renamedNewNames.has(c.name) && !c.from
			)

			const stmts: string[] = []
			for (const c of renames) {
				stmts.push(`ALTER TABLE "${props.name}" RENAME COLUMN "${c.from}" TO "${c.name}"`)
			}
			for (const c of additions) {
				stmts.push(`ALTER TABLE "${props.name}" ADD COLUMN IF NOT EXISTS ${columnSql(c)}`)
			}

			if (stmts.length === 0) {
				ctx.log.info(`Table ${props.name} unchanged at the column level`)
			} else {
				ctx.log.info(
					`Table ${props.name}: ${renames.length} rename(s), ${additions.length} addition(s)`
				)
				await runSql(parent, user, database, stmts.join(';\n'), ctx)
			}
		}

		// Indexes — always idempotent via IF NOT EXISTS, so safe to re-run.
		// (DROP for removed indexes is a v0.0 follow-up.)
		for (const idx of props.indexes) {
			await runSql(parent, user, database, buildCreateIndex(props.name, idx), ctx)
		}

		return { name: props.name, columns: props.columns.map((c) => c.name) }
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
})

// ─────────────────────────────────────────────────────────────────────────────
//  SQL builders — exported for tests + future rich-diff work
// ─────────────────────────────────────────────────────────────────────────────

export function buildCreateTable(props: { name: string; columns: ColumnSpec[] }): string {
	const colSqls = props.columns.map(columnSql)
	return `CREATE TABLE IF NOT EXISTS "${props.name}" (\n  ${colSqls.join(',\n  ')}\n)`
}

export function columnSql(c: ColumnSpec): string {
	const parts = [`"${c.name}"`, c.type]
	if (c.primaryKey) parts.push('PRIMARY KEY')
	if (c.notNull && !c.primaryKey) parts.push('NOT NULL')
	if (c.unique && !c.primaryKey) parts.push('UNIQUE')
	if (c.default !== undefined) parts.push(`DEFAULT ${c.default}`)
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
	/** SQL statements in apply order. */
	sql: string[]
}

export function diffTable(
	tableName: string,
	next: ColumnSpec[],
	priorColumnNames: string[]
): TableDiff {
	const priorCols = new Set(priorColumnNames)
	const renames = next.filter(
		(c) =>
			typeof c.from === 'string' &&
			c.from.length > 0 &&
			priorCols.has(c.from) &&
			!priorCols.has(c.name)
	)
	const renamedNewNames = new Set(renames.map((c) => c.name))
	const additions = next.filter(
		(c) => !priorCols.has(c.name) && !renamedNewNames.has(c.name) && !c.from
	)
	const sql: string[] = []
	for (const c of renames) {
		sql.push(`ALTER TABLE "${tableName}" RENAME COLUMN "${c.from}" TO "${c.name}"`)
	}
	for (const c of additions) {
		sql.push(`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS ${columnSql(c)}`)
	}
	return {
		renames: renames.map((c) => ({ from: c.from as string, to: c.name })),
		additions,
		sql,
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
