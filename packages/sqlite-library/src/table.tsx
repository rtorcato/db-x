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
import { findSqliteParent, queryJson, requireSqliteParent, runSql } from './exec.js'

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
	/**
	 * Column attributes `refresh` found changed out of band — one human-readable
	 * line per column. Deliberately NOT folded back into `columns`: SQLite has no
	 * `ALTER COLUMN` (#56), so a rewritten spec would make `diffTable` throw and
	 * take `preview` down for the whole deployment over a change nothing in the
	 * JSX can fix. Reporting it and leaving `columns` alone keeps `preview`
	 * usable; `apply` clears the key by not emitting it.
	 */
	columnDrift?: string[]
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

		// `CREATE TABLE IF NOT EXISTS` is idempotent, so taking this path when
		// the table does still exist costs nothing — but taking the ALTER path
		// when it doesn't is a hard failure.
		const priorIsGone = prior !== null && normalizePriorColumns(prior.outputs.columns).length === 0

		// The columns the database actually has once this apply is done. Only
		// the CREATE and the diff SQL below move it off the last-applied set.
		let columns = props.columns

		if (!prior || priorIsGone) {
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
				// Nothing ran, so the live table still has the columns we last
				// applied. Recording the desired ones instead would claim a change
				// that never happened, and the next diff — which reads `outputs` —
				// would never plan the repair.
				columns = normalizePriorColumns(prior.outputs.columns)
			} else {
				ctx.log.info(`Table ${props.name}: ${summarize(diff)}`)
				await runSql(parent, diff.sql.join(';\n'), ctx)
			}
		}

		// Index creates — always idempotent via IF NOT EXISTS, so safe to re-run.
		// (Removed indexes are dropped via diffTable above.)
		for (const idx of props.indexes) {
			await runSql(parent, buildCreateIndex(props.name, idx), ctx)
		}

		// `indexes` tracks the props: every declared index is (re-)created just
		// above on every apply, and removed ones are dropped by the diff.
		return { name: props.name, columns, indexes: props.indexes }
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
	/**
	 * Read-only drift check: does the live table still look like what we
	 * applied? Answers the question `db-x refresh` exists for — "someone
	 * dropped a column / deleted the database behind my back".
	 *
	 * Returns the stored outputs unchanged when the live table matches, so an
	 * in-sync database reports no drift rather than churning on cosmetic
	 * differences (SQLite reports resolved type names and its own default
	 * spellings, which never round-trip to the authored props exactly).
	 *
	 * Column *attribute* drift (type, NOT NULL, default, primary key) is reported
	 * in `columnDrift` rather than folded back into `columns` — see the field's
	 * doc comment for why rewriting the spec would break `preview`. Index shape
	 * drift IS written into `indexes`, because a DROP + CREATE fixes it.
	 */
	refresh: async (state, ctx) => {
		const parent = findSqliteParent(ctx)
		if (!parent) {
			ctx.log.warn(`Parent sqlite missing; cannot refresh table ${state.outputs.name}`)
			return state.outputs
		}
		const table = state.outputs.name
		const gone = { ...state.outputs, columns: [], indexes: [] }

		let liveColumns: LiveColumn[]
		let liveIndexList: Array<Record<string, unknown>>
		let liveIndexes: IndexSpec[]
		try {
			liveColumns = (await queryJson(
				parent,
				`PRAGMA table_info(${quoteIdent(table)})`,
				ctx
			)) as unknown as LiveColumn[]
			liveIndexList = await queryJson(parent, `PRAGMA index_list(${quoteIdent(table)})`, ctx)
			// `index_list` names the indexes; only `index_info` says what they
			// cover, so an index rebuilt over different columns needs this second
			// pragma to be visible at all. Auto-indexes back UNIQUE and PRIMARY KEY
			// constraints, and are not ours to track.
			liveIndexes = []
			for (const row of liveIndexList) {
				if (row.origin !== undefined && row.origin !== 'c') continue
				const name = String(row.name)
				if (name.startsWith('sqlite_autoindex_')) continue
				const cols = await queryJson(parent, `PRAGMA index_info(${quoteIdent(name)})`, ctx)
				liveIndexes.push({
					name,
					columns: cols
						.slice()
						.sort((a, b) => Number(a.seqno) - Number(b.seqno))
						.map((c) => String(c.name)),
					...(row.unique ? { unique: true } : {}),
				})
			}
		} catch (err) {
			// `-readonly` refuses to open a database file that isn't there, which
			// is exactly the "I deleted the .db" case — report the table as gone
			// rather than letting sqlite3 create an empty file to satisfy us.
			ctx.log.warn(`${table}: ${(err as Error).message}`)
			return gone
		}

		if (liveColumns.length === 0) return gone

		const liveColNames = liveColumns.map((c) => String(c.name)).sort()
		const storedColNames = state.outputs.columns.map((c) => c.name).sort()
		const storedIndexes = new Map(state.outputs.indexes.map((i) => [i.name, i]))
		const drift = collectColumnDrift(state.outputs.columns, liveColumns)
		for (const line of drift) ctx.log.warn(`${table}.${line} — needs a table rebuild (#56)`)

		const namesMatch = JSON.stringify(liveColNames) === JSON.stringify(storedColNames)
		// Shape, not just name: an index rebuilt over different columns keeps its
		// name, so comparing names alone reports an in-sync database.
		const indexesMatch =
			liveIndexes.length === storedIndexes.size &&
			liveIndexes.every((i) => {
				const stored = storedIndexes.get(i.name)
				return stored !== undefined && indexShape(stored) === indexShape(i)
			})

		if (namesMatch && indexesMatch && drift.length === 0) {
			// In sync. Return the stored outputs byte-for-byte so refresh reports
			// no drift rather than churning on cosmetic differences (SQLite
			// reports resolved type names and its own default spellings, which
			// never round-trip to the authored props exactly) — but drop a
			// `columnDrift` left by an earlier run, now that it is repaired.
			if (state.outputs.columnDrift === undefined) return state.outputs
			const { columnDrift: _repaired, ...cleared } = state.outputs
			return cleared
		}

		// Keep the authored spec for every column and index that still exists,
		// and only describe genuinely-unknown ones from introspection. Returning
		// SQLite's own view wholesale would rewrite `integer` as `INTEGER` and
		// re-spell defaults, which the next diff reads as a type change — and
		// SQLite cannot ALTER COLUMN, so `preview` would hard-fail on a database
		// that is merely missing one column.
		const storedColumns = new Map(state.outputs.columns.map((c) => [c.name, c]))
		// Rebuilt from scratch below when it still applies, so a repaired column
		// doesn't leave last run's warning behind.
		const { columnDrift: _previous, ...base } = state.outputs
		return {
			...base,
			columns: liveColumns.map((c) => {
				const name = String(c.name)
				return (
					storedColumns.get(name) ?? {
						name,
						type: String(c.type),
						...(c.pk ? { primaryKey: true } : {}),
						...(c.notnull ? { notNull: true } : {}),
						...(c.dflt_value === null || c.dflt_value === undefined
							? {}
							: { default: String(c.dflt_value) }),
					}
				)
			}),
			// The live shape wins for an index that moved — that is the drift the
			// next `diffTable` turns into a DROP + CREATE. Authored specs survive
			// unchanged so `description` isn't lost on every refresh.
			indexes: liveIndexes.map((i) => {
				const stored = storedIndexes.get(i.name)
				return stored && indexShape(stored) === indexShape(i) ? stored : i
			}),
			...(drift.length > 0 ? { columnDrift: drift } : {}),
		}
	},
	// Pure diff at plan time so `preview` / `apply` can classify destructive
	// changes (DROP INDEX) before any SQL runs. Compares desired columns/
	// indexes against the last-applied outputs. Throws if the diff would
	// require an unsupported SQLite ALTER COLUMN.
	plan: (props, prior): PlanAction => {
		if (!prior) return { type: 'create' }
		// A prior with no columns means refresh looked and found nothing — the
		// table (or the whole database file) is gone. Altering it would emit
		// ADD COLUMN against something that doesn't exist; it needs creating.
		if (normalizePriorColumns(prior.outputs.columns).length === 0) return { type: 'create' }
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

/** Double-quote an identifier for interpolation into a PRAGMA. */
function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`
}

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

// The bare words SQLite accepts as a DEFAULT without quotes or parens.
const BARE_DEFAULTS = new Set([
	'null',
	'true',
	'false',
	'current_timestamp',
	'current_date',
	'current_time',
])

/**
 * Render a `DEFAULT` clause, or refuse.
 *
 * `default` is raw SQL, so a literal string has to carry its own quotes:
 * `default="'blue'"`, not `default="blue"`. The old fallback wrapped anything
 * unrecognised in parens and hoped it was an expression, which turned
 * `default="blue"` into `DEFAULT (blue)` — accepted by the planner, then
 * rejected by SQLite at apply time with "default value of column [x] is not
 * constant". Failing here instead means the plan never renders a statement
 * that cannot run, and the message names the exact replacement.
 *
 * A bare function call (`datetime('now')`) is still parenthesised for the
 * caller — that is the one unquoted form where the intent is unambiguous.
 */
function formatDefault(name: string, value: string): string {
	const trimmed = value.trim()
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
	if (/^'([^']|'')*'$/.test(trimmed)) return trimmed
	if (/^[xX]'[0-9a-fA-F]*'$/.test(trimmed)) return trimmed
	if (BARE_DEFAULTS.has(trimmed.toLowerCase())) return trimmed
	if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed
	if (trimmed.includes('(')) return `(${trimmed})`

	if (trimmed === '') {
		throw new Error(
			`<Column name="${name}" default="">: an empty default is not valid SQL. Use default="''" for an empty string, or omit the prop for no default.`
		)
	}
	throw new Error(
		`<Column name="${name}" default="${value}">: this would emit DEFAULT (${trimmed}), which SQLite evaluates as an expression and rejects — "default value of column [${name}] is not constant". ` +
			`\`default\` is raw SQL, so a literal string carries its own quotes: default="'${trimmed.replace(/'/g, "''")}'". For an expression, wrap it in parens.`
	)
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
	if (c.default !== undefined) parts.push(`DEFAULT ${formatDefault(c.name, c.default)}`)
	return parts.join(' ')
}

export function buildCreateIndex(tableName: string, idx: IndexSpec): string {
	const unique = idx.unique ? 'UNIQUE ' : ''
	const cols = idx.columns.map((c) => `"${c}"`).join(', ')
	return `CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${tableName}" (${cols})`
}

// ─────────────────────────────────────────────────────────────────────────────
//  Introspection normalisation — pure, so the false-positive surface is testable
// ─────────────────────────────────────────────────────────────────────────────

/** One `PRAGMA table_info` row. */
export interface LiveColumn {
	name: string
	type: string
	notnull: number
	dflt_value: string | null
	pk: number
}

/**
 * Reduce a `DEFAULT` clause to a comparable value.
 *
 * SQLite stores the default as written but strips one layer of parens on the
 * way back out: `DEFAULT (datetime('now'))` reads back as `datetime('now')`,
 * while `columnSql` always emits the parenthesised form. Stripping both sides
 * is what stops `examples/sqlite`'s `created_at` reporting drift forever.
 * Numbers are compared by value so `0`, `0.0` and `(0)` agree.
 */
export function normalizeDefault(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null
	const trimmed = value.trim()
	if (trimmed === '') return null
	const bare =
		trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1).trim() : trimmed
	if (/^-?\d+(\.\d+)?$/.test(bare)) return String(Number(bare))
	if (BARE_DEFAULTS.has(bare.toLowerCase())) return bare.toLowerCase()
	return bare
}

/** The authored default, rendered the way `apply` would have written it. */
function specDefault(spec: ColumnSpec): string | null {
	if (spec.default === undefined) return null
	try {
		return normalizeDefault(formatDefault(spec.name, spec.default))
	} catch {
		// An unrenderable default can't have been applied, so there is nothing
		// to compare against. Refusing here would abort the whole read-only
		// refresh over a diagnostic the plan already reports.
		return normalizeDefault(spec.default)
	}
}

/**
 * Compare one authored column against what `PRAGMA table_info` reports, and
 * describe the difference — or return `null` when they agree.
 *
 * Every comparison mirrors what `columnSql` actually emits, which is what keeps
 * an in-sync database quiet: `serial` resolves to `INTEGER`, `NOT NULL` is
 * suppressed on a primary key (and SQLite reports `notnull=0` for
 * `INTEGER PRIMARY KEY` regardless), and defaults go through `normalizeDefault`.
 *
 * ponytail: `unique` is not compared — it lives in an `sqlite_autoindex_*`
 * entry rather than in `table_info`, so checking it means a second pragma per
 * column. Add that when a dropped UNIQUE actually bites someone.
 */
export function columnDrift(spec: ColumnSpec, live: LiveColumn): string | null {
	const want = resolveType(spec.type).toUpperCase()
	const got = resolveType(String(live.type)).toUpperCase()
	if (want !== got) return `${spec.name}: type is ${got}, expected ${want}`

	const wantNotNull = !!spec.notNull && !spec.primaryKey
	if (wantNotNull !== !!live.notnull) {
		return `${spec.name}: is ${live.notnull ? 'NOT NULL' : 'nullable'}, expected ${wantNotNull ? 'NOT NULL' : 'nullable'}`
	}

	const wantPk = !!spec.primaryKey
	if (wantPk !== live.pk > 0) {
		return `${spec.name}: is ${live.pk > 0 ? '' : 'not '}a primary key, expected ${wantPk ? '' : 'not '}to be`
	}

	const wantDefault = specDefault(spec)
	const gotDefault = normalizeDefault(live.dflt_value)
	if (wantDefault !== gotDefault) {
		return `${spec.name}: default is ${gotDefault ?? 'unset'}, expected ${wantDefault ?? 'unset'}`
	}

	return null
}

/** Every attribute difference between the stored specs and the live table. */
export function collectColumnDrift(stored: ColumnSpec[], live: LiveColumn[]): string[] {
	const liveByName = new Map(live.map((c) => [String(c.name), c]))
	const drift: string[] = []
	for (const spec of stored) {
		const found = liveByName.get(spec.name)
		// A column that is missing entirely is name-set drift, reported by the
		// caller rewriting `columns` — not an attribute change.
		if (!found) continue
		const reason = columnDrift(spec, found)
		if (reason) drift.push(reason)
	}
	return drift
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
	/** Same name, different columns/unique — dropped and recreated. */
	changedIndexes: IndexSpec[]
	/** Names of columns present in prior state but no longer declared. */
	droppedColumns: string[]
	/** SQL statements in apply order. */
	sql: string[]
	/**
	 * The subset of `sql` that is destructive — drops a schema object.
	 */
	destructive: string[]
}

/** One-line diff summary, shared by the apply log and the plan reason. */
function summarize(diff: TableDiff): string {
	return (
		`${diff.renames.length} rename(s), ${diff.additions.length} addition(s), ` +
		`${diff.droppedIndexes.length} index drop(s), ${diff.changedIndexes.length} index change(s), ` +
		`${diff.droppedColumns.length} column drop(s)`
	)
}

/**
 * Index identity for change detection — the fields that define what the index
 * covers. `description` is documentation, so it is deliberately excluded.
 */
function indexShape(i: IndexSpec): string {
	return JSON.stringify([i.columns, !!i.unique])
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

	// 4. Removed and changed indexes.
	const nextIndexNames = new Set(nextIndexes.map((i) => i.name))
	const droppedIndexes = prior.indexes.filter((i) => !nextIndexNames.has(i.name)).map((i) => i.name)
	const priorIndexByName = new Map(prior.indexes.map((i) => [i.name, i]))
	// An index whose name survives but whose definition moved: the create loop's
	// `CREATE INDEX IF NOT EXISTS` sees the name and does nothing, so the change
	// needs an explicit drop first.
	const changedIndexes = nextIndexes.filter((i) => {
		const p = priorIndexByName.get(i.name)
		// State written before `refresh` read `PRAGMA index_info` records
		// `{ name, columns: [] }` — an unknown shape, not a changed one.
		// Comparing it would drop and rebuild on the first apply after an upgrade.
		if (!p || p.columns.length === 0) return false
		return indexShape(p) !== indexShape(i)
	})

	// 5. Removed columns — in prior state, no longer declared, and not the
	//    source side of a rename (that column lives on under its new name).
	//    SQLite 3.35+ has a native DROP COLUMN, but refuses one that is a PK,
	//    UNIQUE, or still indexed; those are rejected here so the plan never
	//    renders a statement that dies mid-apply.
	const nextNames = new Set(next.map((c) => c.name))
	const renameSources = new Set(renames.map((c) => c.from as string))
	const dropped = prior.columns.filter((c) => !nextNames.has(c.name) && !renameSources.has(c.name))
	for (const c of dropped) assertDroppable(tableName, c, nextIndexes)
	const droppedColumns = dropped.map((c) => c.name)

	const sql: string[] = [
		...renames.map((c) => `ALTER TABLE "${tableName}" RENAME COLUMN "${c.from}" TO "${c.name}"`),
		// SQLite's `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` clause.
		...additions.map((c) => `ALTER TABLE "${tableName}" ADD COLUMN ${columnSql(c)}`),
		// Index drops first: SQLite refuses to drop a column an index still covers.
		...droppedIndexes.map((n) => `DROP INDEX IF EXISTS "${n}"`),
		...changedIndexes.map((i) => `DROP INDEX IF EXISTS "${i.name}"`),
		...droppedColumns.map((n) => `ALTER TABLE "${tableName}" DROP COLUMN "${n}"`),
		// Recreated last, once every column it can reference exists. `apply`'s
		// create loop would cover this too; emitting it here is what makes
		// `preview` show the whole change.
		...changedIndexes.map((i) => buildCreateIndex(tableName, i)),
	]

	return {
		renames: renames.map((c) => ({ from: c.from as string, to: c.name })),
		additions,
		droppedIndexes,
		changedIndexes,
		droppedColumns,
		sql,
		destructive: sql.filter(isDestructiveSql),
	}
}

/**
 * Throws when SQLite would refuse to drop `column`: it is a PRIMARY KEY, carries
 * a UNIQUE constraint, or a still-declared index covers it. (Dropping the index
 * in the same JSX edit is fine — the DROP INDEX is emitted first.) A CHECK
 * constraint, view or trigger over the column would also refuse, but none of
 * those are expressible in the JSX, so they can only arrive out of band.
 */
function assertDroppable(tableName: string, column: ColumnSpec, nextIndexes: IndexSpec[]): void {
	const fail = (why: string): never => {
		throw new Error(
			`SQLite can't DROP COLUMN "${column.name}" on table "${tableName}" (${why}); needs a table rebuild — not supported yet.`
		)
	}
	if (column.primaryKey) fail('primary key')
	if (column.unique) fail('UNIQUE constraint')
	const idx = nextIndexes.find((i) => i.columns.includes(column.name))
	if (idx) fail(`still indexed by "${idx.name}"`)
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
