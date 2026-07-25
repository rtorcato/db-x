import { describe, expect, it } from 'vitest'
import { type ColumnSpec, diffTable } from './table.js'

describe('diffTable', () => {
	const baseCol = (overrides: Partial<ColumnSpec>): ColumnSpec => ({
		name: 'x',
		type: 'text',
		...overrides,
	})

	it('returns no statements when columns are unchanged', () => {
		const next = [baseCol({ name: 'id', type: 'serial', primaryKey: true })]
		const diff = diffTable('todos', next, ['id'])
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('emits ADD COLUMN for net-new columns', () => {
		const next = [
			baseCol({ name: 'id', type: 'serial', primaryKey: true }),
			baseCol({ name: 'priority', type: 'int', notNull: true, default: '0' }),
		]
		const diff = diffTable('todos', next, ['id'])
		expect(diff.renames).toEqual([])
		expect(diff.additions.map((c) => c.name)).toEqual(['priority'])
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "priority" int NOT NULL DEFAULT 0',
		])
	})

	it('emits RENAME COLUMN when `from` points at a prior name', () => {
		const next = [
			baseCol({ name: 'id', type: 'serial', primaryKey: true }),
			baseCol({ name: 'title', from: 'name', type: 'citext', notNull: true }),
		]
		const diff = diffTable('todos', next, ['id', 'name'])
		expect(diff.renames).toEqual([{ from: 'name', to: 'title' }])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual(['ALTER TABLE "todos" RENAME COLUMN "name" TO "title"'])
	})

	it('orders RENAME before ADD when both apply', () => {
		const next = [
			baseCol({ name: 'id', type: 'serial', primaryKey: true }),
			baseCol({ name: 'title', from: 'name', type: 'citext', notNull: true }),
			baseCol({ name: 'priority', type: 'int', notNull: true, default: '0' }),
		]
		const diff = diffTable('todos', next, ['id', 'name'])
		expect(diff.renames).toEqual([{ from: 'name', to: 'title' }])
		expect(diff.additions.map((c) => c.name)).toEqual(['priority'])
		expect(diff.sql).toEqual([
			'ALTER TABLE "todos" RENAME COLUMN "name" TO "title"',
			'ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "priority" int NOT NULL DEFAULT 0',
		])
	})

	it('ignores `from` when the target name already exists (defensive)', () => {
		// The new name `title` is already in priorCols, so this isn't a
		// rename — it's a no-op. We must NOT emit a RENAME that would error.
		const next = [baseCol({ name: 'title', from: 'name', type: 'citext' })]
		const diff = diffTable('todos', next, ['title'])
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual([])
	})

	it('ignores `from` when the prior column does not exist', () => {
		// `from='oldname'` but oldname isn't in the prior — there's nothing
		// to rename. The column with `from` is treated as already-resolved
		// (no addition, no rename).
		const next = [baseCol({ name: 'title', from: 'oldname', type: 'citext' })]
		const diff = diffTable('todos', next, ['id'])
		expect(diff.renames).toEqual([])
		expect(diff.additions).toEqual([])
		expect(diff.sql).toEqual([])
	})
})
