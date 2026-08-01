import { getComponentSpec, type PlanAction } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import {
	type ColumnSpec,
	type IndexSpec,
	type LiveColumn,
	buildCreateTable,
	collectColumnDrift,
	columnDrift,
	columnSql,
	diffTable,
	normalizeDefault,
} from './table.js'

const col = (o: Partial<ColumnSpec> & { name: string }): ColumnSpec => ({ type: 'text', ...o })
const prior = (columns: ColumnSpec[], indexes: IndexSpec[] = []) => ({ columns, indexes })

const idCol = col({ name: 'id', type: 'serial', primaryKey: true })

describe('columnSql — type aliases', () => {
	it('emits INTEGER PRIMARY KEY AUTOINCREMENT for serial + primaryKey', () => {
		expect(columnSql(idCol)).toBe('"id" INTEGER PRIMARY KEY AUTOINCREMENT')
	})

	it('aliases boolean/uuid/timestamptz/int/citext to native SQLite types', () => {
		expect(columnSql(col({ name: 'done', type: 'boolean' }))).toBe('"done" INTEGER')
		expect(columnSql(col({ name: 'id2', type: 'uuid' }))).toBe('"id2" TEXT')
		expect(columnSql(col({ name: 'ts', type: 'timestamptz' }))).toBe('"ts" TEXT')
		expect(columnSql(col({ name: 'n', type: 'int' }))).toBe('"n" INTEGER')
		expect(columnSql(col({ name: 'title', type: 'citext' }))).toBe('"title" TEXT')
	})

	it('keeps native SQLite storage classes as-is', () => {
		expect(columnSql(col({ name: 'n', type: 'REAL' }))).toBe('"n" REAL')
		expect(columnSql(col({ name: 'b', type: 'BLOB' }))).toBe('"b" BLOB')
	})

	it('wraps a bare expression default in parens, leaves literals alone', () => {
		expect(columnSql(col({ name: 'n', type: 'int', default: '0' }))).toBe('"n" INTEGER DEFAULT 0')
		expect(columnSql(col({ name: 'created_at', type: 'text', default: "datetime('now')" }))).toBe(
			`"created_at" text DEFAULT (datetime('now'))`
		)
		expect(columnSql(col({ name: 'created_at', type: 'text', default: "(datetime('now'))" }))).toBe(
			`"created_at" text DEFAULT (datetime('now'))`
		)
	})
})

describe('buildCreateTable', () => {
	it('emits CREATE TABLE IF NOT EXISTS', () => {
		expect(buildCreateTable({ name: 'todos', columns: [idCol] })).toBe(
			'CREATE TABLE IF NOT EXISTS "todos" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT\n)'
		)
	})
})

describe('diffTable — columns & renames', () => {
	it('returns no statements when columns are unchanged', () => {
		const diff = diffTable('todos', [idCol], [], prior([idCol]))
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('emits ADD COLUMN (no IF NOT EXISTS) for net-new columns', () => {
		const next = [idCol, col({ name: 'priority', type: 'int', notNull: true, default: '0' })]
		const diff = diffTable('todos', next, [], prior([idCol]))
		expect(diff.additions.map((c) => c.name)).toEqual(['priority'])
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0',
		])
	})

	it('emits RENAME COLUMN when `from` points at a prior name', () => {
		const next = [idCol, col({ name: 'title', from: 'name', type: 'text', notNull: true })]
		const p = prior([idCol, col({ name: 'name', type: 'text', notNull: true })])
		const diff = diffTable('todos', next, [], p)
		expect(diff.renames).toEqual([{ from: 'name', to: 'title' }])
		expect(diff.sql).toEqual(['ALTER TABLE "todos" RENAME COLUMN "name" TO "title"'])
	})

	it('orders RENAME before ADD when both apply', () => {
		const next = [
			idCol,
			col({ name: 'title', from: 'name', type: 'text', notNull: true }),
			col({ name: 'priority', type: 'int', notNull: true, default: '0' }),
		]
		const p = prior([idCol, col({ name: 'name', type: 'text', notNull: true })])
		const diff = diffTable('todos', next, [], p)
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" RENAME COLUMN "name" TO "title"',
			'ALTER TABLE "todos" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0',
		])
	})

	it('ignores `from` when the target name already exists (defensive)', () => {
		const next = [col({ name: 'title', from: 'name', type: 'text' })]
		const diff = diffTable('todos', next, [], prior([col({ name: 'title', type: 'text' })]))
		expect(diff.renames).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('ignores `from` when the prior column does not exist', () => {
		const next = [idCol, col({ name: 'title', from: 'oldname', type: 'text' })]
		const diff = diffTable('todos', next, [], prior([idCol]))
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual([])
	})
})

describe('diffTable — indexes', () => {
	it('drops indexes present in prior but no longer declared', () => {
		const idx: IndexSpec = { name: 'idx_old', columns: ['a'] }
		const diff = diffTable(
			't',
			[col({ name: 'a', type: 'int' })],
			[],
			prior([col({ name: 'a', type: 'int' })], [idx])
		)
		expect(diff.droppedIndexes).toEqual(['idx_old'])
		expect(diff.sql).toEqual(['DROP INDEX IF EXISTS "idx_old"'])
		expect(diff.destructive).toEqual(['DROP INDEX IF EXISTS "idx_old"'])
	})

	it('keeps an index that is still declared', () => {
		const idx: IndexSpec = { name: 'idx_a', columns: ['a'] }
		const diff = diffTable(
			't',
			[col({ name: 'a', type: 'int' })],
			[idx],
			prior([col({ name: 'a', type: 'int' })], [idx])
		)
		expect(diff.droppedIndexes).toEqual([])
		expect(diff.sql).toEqual([])
	})

	// The bug: the diff compared index names only, so a changed definition
	// produced no SQL — and `CREATE INDEX IF NOT EXISTS` saw the surviving name
	// and did nothing, leaving the old index live while state claimed the new one.
	it('drops and recreates an index whose columns changed', () => {
		const a = col({ name: 'a', type: 'int' })
		const b = col({ name: 'b', type: 'int' })
		const diff = diffTable(
			't',
			[a, b],
			[{ name: 'idx', columns: ['a', 'b'] }],
			prior([a, b], [{ name: 'idx', columns: ['a'] }])
		)
		expect(diff.changedIndexes).toEqual([{ name: 'idx', columns: ['a', 'b'] }])
		expect(diff.sql).toEqual([
			'DROP INDEX IF EXISTS "idx"',
			'CREATE INDEX IF NOT EXISTS "idx" ON "t" ("a", "b")',
		])
		expect(diff.destructive).toEqual(['DROP INDEX IF EXISTS "idx"'])
	})

	it('drops and recreates an index whose unique flag flipped', () => {
		const a = col({ name: 'a', type: 'int' })
		const diff = diffTable(
			't',
			[a],
			[{ name: 'idx', columns: ['a'], unique: true }],
			prior([a], [{ name: 'idx', columns: ['a'] }])
		)
		expect(diff.sql).toEqual([
			'DROP INDEX IF EXISTS "idx"',
			'CREATE UNIQUE INDEX IF NOT EXISTS "idx" ON "t" ("a")',
		])
	})

	it('ignores a description-only change', () => {
		const a = col({ name: 'a', type: 'int' })
		const diff = diffTable(
			't',
			[a],
			[{ name: 'idx', columns: ['a'], description: 'new words' }],
			prior([a], [{ name: 'idx', columns: ['a'], description: 'old words' }])
		)
		expect(diff.changedIndexes).toEqual([])
		expect(diff.sql).toEqual([])
	})

	// State written before `refresh` read `PRAGMA index_info` records
	// `{ name, columns: [] }` — an unknown shape, not a changed one. Treating it
	// as changed would rebuild the index on the first apply after an upgrade.
	it('leaves an index with an unknown prior shape alone', () => {
		const a = col({ name: 'a', type: 'int' })
		const diff = diffTable(
			't',
			[a],
			[{ name: 'idx', columns: ['a'] }],
			prior([a], [{ name: 'idx', columns: [] }])
		)
		expect(diff.changedIndexes).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('recreates a changed index after a column drop, not before', () => {
		const a = col({ name: 'a', type: 'int' })
		const diff = diffTable(
			't',
			[a],
			[{ name: 'idx', columns: ['a'] }],
			prior([a, col({ name: 'gone', type: 'int' })], [{ name: 'idx', columns: ['gone'] }])
		)
		expect(diff.sql).toEqual([
			'DROP INDEX IF EXISTS "idx"',
			'ALTER TABLE "t" DROP COLUMN "gone"',
			'CREATE INDEX IF NOT EXISTS "idx" ON "t" ("a")',
		])
	})
})

describe('diffTable — dropped columns', () => {
	// The bug: a column removed from the JSX vanished from the plan entirely —
	// no SQL, no `destructive` entry, no warning, and it survived in the DB.
	it('emits DROP COLUMN, flagged destructive, for a column no longer declared', () => {
		const gone = col({ name: 'priority', type: 'int' })
		const diff = diffTable('todos', [idCol], [], prior([idCol, gone]))
		expect(diff.droppedColumns).toEqual(['priority'])
		expect(diff.sql).toEqual(['ALTER TABLE "todos" DROP COLUMN "priority"'])
		expect(diff.destructive).toEqual(['ALTER TABLE "todos" DROP COLUMN "priority"'])
	})

	it('does not drop the source column of a rename', () => {
		const next = [idCol, col({ name: 'title', from: 'name' })]
		const diff = diffTable('todos', next, [], prior([idCol, col({ name: 'name' })]))
		expect(diff.droppedColumns).toEqual([])
	})

	it('drops a covering index before the column it covers', () => {
		const a = col({ name: 'a', type: 'int' })
		const b = col({ name: 'b', type: 'int' })
		const idx: IndexSpec = { name: 'idx_b', columns: ['b'] }
		const diff = diffTable('t', [a], [], prior([a, b], [idx]))
		expect(diff.sql).toEqual(['DROP INDEX IF EXISTS "idx_b"', 'ALTER TABLE "t" DROP COLUMN "b"'])
	})

	// SQLite refuses these at runtime; refusing at plan time keeps a statement
	// that cannot run out of an approved plan.
	it('refuses to drop a primary key, a UNIQUE column, or a still-indexed one', () => {
		const a = col({ name: 'a', type: 'int' })
		expect(() => diffTable('t', [a], [], prior([a, idCol]))).toThrow(
			/can't DROP COLUMN "id".*primary key/
		)
		expect(() => diffTable('t', [a], [], prior([a, col({ name: 'email', unique: true })]))).toThrow(
			/can't DROP COLUMN "email".*UNIQUE/
		)
		const idx: IndexSpec = { name: 'idx_b', columns: ['b'] }
		expect(() => diffTable('t', [a], [idx], prior([a, col({ name: 'b' })], [idx]))).toThrow(
			/can't DROP COLUMN "b".*still indexed by "idx_b"/
		)
	})
})

describe('diffTable — unsupported ALTER COLUMN throws', () => {
	it('throws on a type change', () => {
		expect(() =>
			diffTable(
				't',
				[col({ name: 'n', type: 'int' })],
				[],
				prior([col({ name: 'n', type: 'text' })])
			)
		).toThrow(/can't ALTER COLUMN "n".*type change/)
	})

	it('throws on a default change', () => {
		expect(() =>
			diffTable(
				't',
				[col({ name: 'n', type: 'int', default: '1' })],
				[],
				prior([col({ name: 'n', type: 'int' })])
			)
		).toThrow(/can't ALTER COLUMN "n".*default change/)
	})

	it('throws on a NOT NULL change', () => {
		expect(() =>
			diffTable(
				't',
				[col({ name: 'n', type: 'text', notNull: true })],
				[],
				prior([col({ name: 'n', type: 'text' })])
			)
		).toThrow(/can't ALTER COLUMN "n".*NOT NULL change/)
	})

	it('skips NOT NULL / UNIQUE diffs on a primary-key column', () => {
		const next = [col({ name: 'id', type: 'int', primaryKey: true })]
		const p = prior([col({ name: 'id', type: 'int', notNull: false, unique: false })])
		expect(diffTable('t', next, [], p).sql).toEqual([])
	})
})

describe('columnSql — empty default', () => {
	it('rejects default="" instead of emitting invalid SQL', () => {
		// SQLite produced `DEFAULT ()` and Postgres `DEFAULT ` with nothing
		// after it — both syntax errors, surfaced only at apply time.
		expect(() => columnSql(col({ name: 'desc', type: 'text', default: '' }))).toThrow(
			/empty default is not valid SQL/
		)
		expect(() => columnSql(col({ name: 'desc', type: 'text', default: '   ' }))).toThrow(
			/empty default is not valid SQL/
		)
	})

	it('accepts an explicit empty string literal', () => {
		expect(columnSql(col({ name: 'desc', type: 'text', default: "''" }))).toContain("DEFAULT ''")
	})
})

describe('columnSql — unquoted string default', () => {
	// Verified against sqlite 3.x: `ALTER TABLE t ADD COLUMN a text DEFAULT (blue)`
	// exits 1 with "default value of column [a] is not constant". The old
	// fallback wrapped any unrecognised value in parens, so this only surfaced
	// at apply time — after the plan had been rendered and approved.
	it('rejects a bare word instead of emitting DEFAULT (word)', () => {
		expect(() => columnSql(col({ name: 'color', type: 'text', default: 'blue' }))).toThrow(
			/is not constant/
		)
	})

	it('names the quoted replacement in the message', () => {
		expect(() => columnSql(col({ name: 'color', type: 'text', default: 'blue' }))).toThrow(
			/default="'blue'"/
		)
	})

	it('escapes an embedded quote in the suggestion', () => {
		expect(() => columnSql(col({ name: 'c', type: 'text', default: "it's" }))).toThrow(
			/default="'it''s'"/
		)
	})

	it('rejects a bare emoji — the same class, not an encoding problem', () => {
		expect(() => columnSql(col({ name: 'emoji', type: 'text', default: '👍🏻' }))).toThrow(
			/is not constant/
		)
		expect(columnSql(col({ name: 'emoji', type: 'text', default: "'👍🏻'" }))).toContain(
			"DEFAULT '👍🏻'"
		)
	})

	it('still accepts literals, keywords and expressions', () => {
		expect(columnSql(col({ name: 'n', type: 'integer', default: '0' }))).toContain('DEFAULT 0')
		expect(columnSql(col({ name: 'n', type: 'real', default: '-1.5' }))).toContain('DEFAULT -1.5')
		expect(columnSql(col({ name: 's', type: 'text', default: "'blue'" }))).toContain(
			"DEFAULT 'blue'"
		)
		expect(columnSql(col({ name: 's', type: 'text', default: "'it''s'" }))).toContain(
			"DEFAULT 'it''s'"
		)
		expect(columnSql(col({ name: 'b', type: 'integer', default: 'NULL' }))).toContain(
			'DEFAULT NULL'
		)
		expect(columnSql(col({ name: 't', type: 'text', default: 'CURRENT_TIMESTAMP' }))).toContain(
			'DEFAULT CURRENT_TIMESTAMP'
		)
		// A bare function call is parenthesised for the caller — the one
		// unquoted form where the intent is unambiguous.
		expect(columnSql(col({ name: 't', type: 'text', default: "datetime('now')" }))).toContain(
			"DEFAULT (datetime('now'))"
		)
		expect(columnSql(col({ name: 't', type: 'text', default: "(datetime('now'))" }))).toContain(
			"DEFAULT (datetime('now'))"
		)
	})
})

describe('TableResource.plan — drift reconciliation', () => {
	const spec = getComponentSpec('@db-x/sqlite-library:table')
	// The registry stores specs erased to Record<string, unknown>, so the plan
	// hook comes back untyped — narrow it once here rather than at each call.
	if (!spec?.plan) throw new Error('sqlite table component is not registered with a plan hook')
	const planHook = spec.plan as (p: object, s: object | null) => PlanAction
	const plan = (props: object, prior: object | null): PlanAction => planHook(props, prior)

	const props = {
		name: 'todos',
		columns: [idCol, col({ name: 'title' })],
		indexes: [] as IndexSpec[],
	}
	const priorOf = (columns: ColumnSpec[]) => ({
		props,
		outputs: { name: 'todos', columns, indexes: [] },
	})

	it('is a no-op when props and live outputs both match', () => {
		expect(plan(props, priorOf(props.columns)).type).toBe('no-op')
	})

	// The bug this guards: plan() used to return no-op whenever props were
	// unchanged, so `refresh` could record that a column had vanished and
	// `preview` would still report nothing to do.
	it('plans the repair when outputs drifted but props did not', () => {
		const action = plan(props, priorOf([idCol]))
		expect(action.type).toBe('update')
		expect('details' in action && action.details?.[0]).toContain('ADD COLUMN "title"')
	})

	it('plans a create when outputs record no columns at all', () => {
		// What refresh writes when the table — or the whole .db file — is gone.
		// An ALTER against a missing table is a hard failure; it needs creating.
		expect(plan(props, priorOf([])).type).toBe('create')
	})
})

describe('TableResource.apply — outputs record what ran, not what was wanted', () => {
	const spec = getComponentSpec('@db-x/sqlite-library:table')
	if (!spec?.apply) throw new Error('sqlite table component is not registered with an apply hook')
	const applyHook = spec.apply as (
		p: object,
		c: object,
		s: object | null
	) => Promise<{ columns: ColumnSpec[] }>

	// No `<Index>` children, so the index-create loop never fires and a no-SQL
	// apply spawns nothing at all — the fake parent is never used to run sqlite3.
	const ctx = {
		resource: { id: 'table:todos', parent: 'sqlite:db' },
		deps: { 'sqlite:db': { file: '/tmp/none.db', exec: { command: 'true', args: [] } } },
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		workDir: '/tmp',
	}

	// The wedge this guards (#89): a props change that emits no SQL used to
	// persist the *desired* columns, so state described a database that did not
	// exist — and the repair it planned next could never run.
	it('keeps the last-applied columns when the diff emitted no SQL', async () => {
		const live = [idCol, col({ name: 'title' })]
		// `from` pointing at nothing is ignored by the diff: no rename, no add.
		const props = {
			name: 'todos',
			columns: [idCol, col({ name: 'title' }), col({ name: 'ghost', from: 'nope' })],
			indexes: [] as IndexSpec[],
		}
		const prior = { props: {}, outputs: { name: 'todos', columns: live, indexes: [] } }
		const outputs = await applyHook(props, ctx, prior)
		expect(outputs.columns.map((c) => c.name)).toEqual(['id', 'title'])
	})
})

// ─────────────────────────────────────────────────────────────────────────────
//  refresh() attribute comparison (#84)
// ─────────────────────────────────────────────────────────────────────────────
//
// This is where the false positives live: report drift on an in-sync database
// and every `refresh` cries wolf about a change SQLite cannot even apply.
// Every `live` row below is real `PRAGMA table_info` output, captured from a
// table built by this library's own `columnSql`.

const live = (o: Partial<LiveColumn> & { name: string }): LiveColumn => ({
	type: 'TEXT',
	notnull: 0,
	dflt_value: null,
	pk: 0,
	...o,
})

describe('normalizeDefault', () => {
	const cases: Array<[string, string | null | undefined, string | null]> = [
		['unset', null, null],
		['undefined', undefined, null],
		['blank', '   ', null],
		// SQLite strips one layer of parens on the way back out, so the authored
		// `(datetime('now'))` and the reported `datetime('now')` must agree.
		['parenthesised expression', "(datetime('now'))", "datetime('now')"],
		['bare expression', "datetime('now')", "datetime('now')"],
		['integer', '0', '0'],
		['float spelling of an integer', '0.0', '0'],
		['parenthesised number', '(0)', '0'],
		['negative', '-1', '-1'],
		['string literal', "'blue'", "'blue'"],
		['empty string literal', "''", "''"],
		['keyword, any case', 'CURRENT_TIMESTAMP', 'current_timestamp'],
	]
	for (const [label, input, expected] of cases) {
		it(`normalizes ${label}`, () => expect(normalizeDefault(input)).toBe(expected))
	}
})

describe('columnDrift — an in-sync database stays quiet', () => {
	// Every column of examples/sqlite's `todos`, paired with what SQLite
	// actually reports for it. None may drift.
	const inSync: Array<[ColumnSpec, LiveColumn]> = [
		[
			col({ name: 'id', type: 'integer', primaryKey: true }),
			live({ name: 'id', type: 'INTEGER', pk: 1 }),
		],
		[col({ name: 'title', type: 'text', notNull: true }), live({ name: 'title', notnull: 1 })],
		[
			col({ name: 'done', type: 'integer', notNull: true, default: '0' }),
			live({ name: 'done', type: 'INTEGER', notnull: 1, dflt_value: '0' }),
		],
		[
			col({ name: 'color', type: 'text', default: "'blue'" }),
			live({ name: 'color', dflt_value: "'blue'" }),
		],
		[
			col({ name: 'dueDate', type: 'text', default: "''" }),
			live({ name: 'dueDate', dflt_value: "''" }),
		],
		[
			col({ name: 'created_at', type: 'text', notNull: true, default: "(datetime('now'))" }),
			live({ name: 'created_at', notnull: 1, dflt_value: "datetime('now')" }),
		],
		// `serial` + primaryKey is emitted as INTEGER PRIMARY KEY AUTOINCREMENT,
		// and SQLite reports notnull=0 for it no matter what.
		[idCol, live({ name: 'id', type: 'INTEGER', pk: 1 })],
		// A primary key suppresses the NOT NULL clause, so the spec asking for it
		// and the table not reporting it is agreement, not drift.
		[
			col({ name: 'id', type: 'integer', primaryKey: true, notNull: true }),
			live({ name: 'id', type: 'INTEGER', pk: 1 }),
		],
		// Friendly aliases resolve to the storage class on both sides.
		[col({ name: 'flag', type: 'boolean' }), live({ name: 'flag', type: 'INTEGER' })],
		[col({ name: 'ref', type: 'uuid' }), live({ name: 'ref', type: 'TEXT' })],
		[col({ name: 'n', type: 'int' }), live({ name: 'n', type: 'INTEGER' })],
	]
	for (const [spec, row] of inSync) {
		it(`${spec.name}: ${spec.type}${spec.default ? ` default ${spec.default}` : ''}`, () => {
			expect(columnDrift(spec, row)).toBeNull()
		})
	}
})

describe('columnDrift — a hand-changed column is reported', () => {
	it('detects a type change', () => {
		const spec = col({ name: 'done', type: 'integer' })
		expect(columnDrift(spec, live({ name: 'done', type: 'TEXT' }))).toContain('type is TEXT')
	})

	it('detects a dropped NOT NULL', () => {
		const spec = col({ name: 'title', notNull: true })
		expect(columnDrift(spec, live({ name: 'title', notnull: 0 }))).toContain('is nullable')
	})

	it('detects an added NOT NULL', () => {
		expect(columnDrift(col({ name: 'title' }), live({ name: 'title', notnull: 1 }))).toContain(
			'is NOT NULL'
		)
	})

	it('detects a changed default', () => {
		const spec = col({ name: 'color', default: "'blue'" })
		expect(columnDrift(spec, live({ name: 'color', dflt_value: "'red'" }))).toContain(
			"default is 'red'"
		)
	})

	it('detects a removed default', () => {
		const spec = col({ name: 'done', type: 'integer', default: '0' })
		expect(columnDrift(spec, live({ name: 'done', type: 'INTEGER' }))).toContain('default is unset')
	})

	it('detects a lost primary key', () => {
		expect(columnDrift(idCol, live({ name: 'id', type: 'INTEGER', pk: 0 }))).toContain(
			'is not a primary key'
		)
	})
})

describe('collectColumnDrift', () => {
	it('reports every drifted column and nothing else', () => {
		const stored = [
			col({ name: 'id', type: 'integer', primaryKey: true }),
			col({ name: 'title', notNull: true }),
			col({ name: 'done', type: 'integer', default: '0' }),
		]
		const rows = [
			live({ name: 'id', type: 'INTEGER', pk: 1 }),
			live({ name: 'title', notnull: 0 }),
			live({ name: 'done', type: 'TEXT', dflt_value: '0' }),
		]
		const drift = collectColumnDrift(stored, rows)
		expect(drift).toHaveLength(2)
		expect(drift[0]).toContain('title')
		expect(drift[1]).toContain('done')
	})

	// A column that vanished is name-set drift; refresh rewrites `columns` for
	// that, and the diff plans the ADD COLUMN. Reporting it here too would
	// double-count it as an unfixable rebuild.
	it('ignores a column that is missing entirely', () => {
		const stored = [col({ name: 'id' }), col({ name: 'gone' })]
		expect(collectColumnDrift(stored, [live({ name: 'id' })])).toEqual([])
	})
})
