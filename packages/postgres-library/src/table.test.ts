import { getComponentSpec } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import { type ColumnSpec, type IndexSpec, columnSql, diffTable } from './table.js'

const col = (o: Partial<ColumnSpec> & { name: string }): ColumnSpec => ({ type: 'text', ...o })
const prior = (columns: ColumnSpec[], indexes: IndexSpec[] = []) => ({ columns, indexes })

const idCol = col({ name: 'id', type: 'serial', primaryKey: true })

describe('diffTable — columns & renames', () => {
	it('returns no statements when columns are unchanged', () => {
		const diff = diffTable('todos', [idCol], [], prior([idCol]))
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.alterations).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('emits ADD COLUMN for net-new columns', () => {
		const next = [idCol, col({ name: 'priority', type: 'int', notNull: true, default: '0' })]
		const diff = diffTable('todos', next, [], prior([idCol]))
		expect(diff.additions.map((c) => c.name)).toEqual(['priority'])
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "priority" int NOT NULL DEFAULT 0',
		])
	})

	it('emits RENAME COLUMN when `from` points at a prior name', () => {
		const next = [idCol, col({ name: 'title', from: 'name', type: 'citext', notNull: true })]
		const p = prior([idCol, col({ name: 'name', type: 'citext', notNull: true })])
		const diff = diffTable('todos', next, [], p)
		expect(diff.renames).toEqual([{ from: 'name', to: 'title' }])
		expect(diff.alterations).toEqual([])
		expect(diff.sql).toEqual(['ALTER TABLE "todos" RENAME COLUMN "name" TO "title"'])
	})

	it('orders RENAME before ADD when both apply', () => {
		const next = [
			idCol,
			col({ name: 'title', from: 'name', type: 'citext', notNull: true }),
			col({ name: 'priority', type: 'int', notNull: true, default: '0' }),
		]
		const p = prior([idCol, col({ name: 'name', type: 'citext', notNull: true })])
		const diff = diffTable('todos', next, [], p)
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" RENAME COLUMN "name" TO "title"',
			'ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "priority" int NOT NULL DEFAULT 0',
		])
	})

	it('applies attribute changes to the renamed (new) name', () => {
		const next = [col({ name: 'title', from: 'name', type: 'citext' })]
		const p = prior([col({ name: 'name', type: 'text' })])
		const diff = diffTable('todos', next, [], p)
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" RENAME COLUMN "name" TO "title"',
			'ALTER TABLE "todos" ALTER COLUMN "title" TYPE citext',
		])
	})

	it('ignores `from` when the target name already exists (defensive)', () => {
		const next = [col({ name: 'title', from: 'name', type: 'citext' })]
		const diff = diffTable('todos', next, [], prior([col({ name: 'title', type: 'citext' })]))
		expect(diff.renames).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('ignores `from` when the prior column does not exist', () => {
		const next = [idCol, col({ name: 'title', from: 'oldname', type: 'citext' })]
		const diff = diffTable('todos', next, [], prior([idCol]))
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual([])
	})
})

describe('diffTable — column attribute alterations', () => {
	it('detects type changes → ALTER COLUMN TYPE', () => {
		const diff = diffTable(
			't',
			[col({ name: 'amount', type: 'bigint' })],
			[],
			prior([col({ name: 'amount', type: 'int' })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" ALTER COLUMN "amount" TYPE bigint'])
	})

	it('detects an added default → SET DEFAULT', () => {
		const diff = diffTable(
			't',
			[col({ name: 'n', type: 'int', default: '0' })],
			[],
			prior([col({ name: 'n', type: 'int' })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" ALTER COLUMN "n" SET DEFAULT 0'])
	})

	it('detects a removed default → DROP DEFAULT', () => {
		const diff = diffTable(
			't',
			[col({ name: 'n', type: 'int' })],
			[],
			prior([col({ name: 'n', type: 'int', default: '0' })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" ALTER COLUMN "n" DROP DEFAULT'])
	})

	it('detects NOT NULL added → SET NOT NULL', () => {
		const diff = diffTable(
			't',
			[col({ name: 'n', type: 'text', notNull: true })],
			[],
			prior([col({ name: 'n', type: 'text' })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" ALTER COLUMN "n" SET NOT NULL'])
	})

	it('detects NOT NULL removed → DROP NOT NULL', () => {
		const diff = diffTable(
			't',
			[col({ name: 'n', type: 'text' })],
			[],
			prior([col({ name: 'n', type: 'text', notNull: true })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" ALTER COLUMN "n" DROP NOT NULL'])
	})

	it('detects UNIQUE added → ADD CONSTRAINT', () => {
		const diff = diffTable(
			't',
			[col({ name: 'email', type: 'text', unique: true })],
			[],
			prior([col({ name: 'email', type: 'text' })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" ADD CONSTRAINT "t_email_key" UNIQUE ("email")'])
	})

	it('detects UNIQUE removed → DROP CONSTRAINT', () => {
		const diff = diffTable(
			't',
			[col({ name: 'email', type: 'text' })],
			[],
			prior([col({ name: 'email', type: 'text', unique: true })])
		)
		expect(diff.sql).toEqual(['ALTER TABLE "t" DROP CONSTRAINT IF EXISTS "t_email_key"'])
	})

	it('skips NOT NULL / UNIQUE diffs on a primary-key column', () => {
		const next = [col({ name: 'id', type: 'int', primaryKey: true })]
		const p = prior([col({ name: 'id', type: 'int', notNull: false, unique: false })])
		expect(diffTable('t', next, [], p).sql).toEqual([])
	})

	it('suppresses attribute diffs for legacy name-only prior state', () => {
		// A pre-rich-diff state stored columns as bare names; normalization
		// gives them the sentinel type. We must not emit a bogus TYPE change.
		const next = [col({ name: 'n', type: 'text', notNull: true })]
		const p = prior([{ name: 'n', type: '__db_x_unknown__' }])
		expect(diffTable('t', next, [], p).sql).toEqual([])
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
})

describe('diffTable — dropped columns', () => {
	// The bug: a column removed from the JSX vanished from the plan entirely —
	// no SQL, no `destructive` entry, no warning, and it survived in the DB.
	it('emits DROP COLUMN, flagged destructive, for a column no longer declared', () => {
		const diff = diffTable('todos', [idCol], [], prior([idCol, col({ name: 'priority' })]))
		expect(diff.droppedColumns).toEqual(['priority'])
		expect(diff.sql).toEqual(['ALTER TABLE "todos" DROP COLUMN IF EXISTS "priority"'])
		expect(diff.destructive).toEqual(['ALTER TABLE "todos" DROP COLUMN IF EXISTS "priority"'])
	})

	it('does not drop the source column of a rename', () => {
		const next = [idCol, col({ name: 'title', from: 'name' })]
		const diff = diffTable('todos', next, [], prior([idCol, col({ name: 'name' })]))
		expect(diff.droppedColumns).toEqual([])
		expect(diff.sql).toEqual(['ALTER TABLE "todos" RENAME COLUMN "name" TO "title"'])
	})

	it('drops the column last, after any index drop', () => {
		const idx: IndexSpec = { name: 'idx_b', columns: ['b'] }
		const a = col({ name: 'a', type: 'int' })
		const diff = diffTable('t', [a], [], prior([a, col({ name: 'b' })], [idx]))
		expect(diff.sql).toEqual([
			'DROP INDEX IF EXISTS "idx_b"',
			'ALTER TABLE "t" DROP COLUMN IF EXISTS "b"',
		])
	})
})

describe('diffTable — destructive classification', () => {
	it('flags a type change as destructive', () => {
		const diff = diffTable(
			't',
			[col({ name: 'n', type: 'bigint' })],
			[],
			prior([col({ name: 'n', type: 'int' })])
		)
		expect(diff.destructive).toEqual(['ALTER TABLE "t" ALTER COLUMN "n" TYPE bigint'])
	})

	it('flags a dropped index as destructive', () => {
		const idx: IndexSpec = { name: 'idx_old', columns: ['a'] }
		const diff = diffTable(
			't',
			[col({ name: 'a', type: 'int' })],
			[],
			prior([col({ name: 'a', type: 'int' })], [idx])
		)
		expect(diff.destructive).toEqual(['DROP INDEX IF EXISTS "idx_old"'])
	})

	it('flags a dropped UNIQUE constraint as destructive', () => {
		const diff = diffTable(
			't',
			[col({ name: 'e', type: 'text' })],
			[],
			prior([col({ name: 'e', type: 'text', unique: true })])
		)
		expect(diff.destructive).toEqual(['ALTER TABLE "t" DROP CONSTRAINT IF EXISTS "t_e_key"'])
	})

	it('does NOT flag renames, additions, SET DEFAULT, DROP DEFAULT, or NOT NULL toggles', () => {
		const next = [
			col({ name: 'id', type: 'serial', primaryKey: true }),
			col({ name: 'title', from: 'name', type: 'text' }), // rename
			col({ name: 'added', type: 'int', default: '0' }), // add
			col({ name: 'd', type: 'int' }), // DROP DEFAULT
			col({ name: 'nn', type: 'text', notNull: true }), // SET NOT NULL
			col({ name: 'un', type: 'text', unique: true }), // ADD UNIQUE
		]
		const diff = diffTable(
			't',
			next,
			[],
			prior([
				col({ name: 'id', type: 'serial', primaryKey: true }),
				col({ name: 'name', type: 'text' }),
				col({ name: 'd', type: 'int', default: '0' }),
				col({ name: 'nn', type: 'text' }),
				col({ name: 'un', type: 'text' }),
			])
		)
		expect(diff.sql.length).toBeGreaterThan(0)
		expect(diff.destructive).toEqual([])
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
	// Postgres reads a bare word in a DEFAULT as a column reference and fails
	// with `column "blue" does not exist` — at apply time, after the plan was
	// rendered and approved. Same trap SQLite springs as "is not constant".
	it('rejects a bare word', () => {
		expect(() => columnSql(col({ name: 'color', type: 'text', default: 'blue' }))).toThrow(
			/does not exist/
		)
	})

	it('names the quoted replacement in the message', () => {
		expect(() => columnSql(col({ name: 'color', type: 'text', default: 'blue' }))).toThrow(
			/default="'blue'"/
		)
	})

	it('still accepts literals, casts, keywords and expressions', () => {
		expect(columnSql(col({ name: 'n', type: 'integer', default: '0' }))).toContain('DEFAULT 0')
		expect(columnSql(col({ name: 's', type: 'text', default: "'blue'" }))).toContain(
			"DEFAULT 'blue'"
		)
		expect(columnSql(col({ name: 's', type: 'text', default: "'{}'::jsonb" }))).toContain(
			"DEFAULT '{}'::jsonb"
		)
		expect(columnSql(col({ name: 'b', type: 'boolean', default: 'true' }))).toContain(
			'DEFAULT true'
		)
		expect(columnSql(col({ name: 't', type: 'timestamptz', default: 'now()' }))).toContain(
			'DEFAULT now()'
		)
		expect(
			columnSql(col({ name: 't', type: 'timestamptz', default: 'CURRENT_TIMESTAMP' }))
		).toContain('DEFAULT CURRENT_TIMESTAMP')
	})
})

describe('TableResource.apply — outputs record what ran, not what was wanted', () => {
	const spec = getComponentSpec('@db-x/postgres-library:table')
	if (!spec?.apply) throw new Error('postgres table component is not registered with an apply hook')
	const applyHook = spec.apply as (
		p: object,
		c: object,
		s: object | null
	) => Promise<{ columns: ColumnSpec[] }>

	// No `<Index>` children, so the index-create loop never fires and a no-SQL
	// apply spawns nothing at all — the fake parent is never used to run psql.
	const ctx = {
		resource: { id: 'table:todos', parent: 'postgres:db' },
		deps: {
			'postgres:db': {
				user: 'u',
				password: 'p',
				database: 'app',
				exec: { command: 'true', args: [] },
			},
		},
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
