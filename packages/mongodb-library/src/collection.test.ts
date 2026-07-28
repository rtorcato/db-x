import { describe, expect, it } from 'vitest'
import {
	type CollectionPrior,
	type CollectionProps,
	type IndexSpec,
	type Validator,
	buildCreateCollection,
	buildCreateIndex,
	diffCollection,
	isValidatorTightened,
} from './collection.js'
import { redact, wrapScript } from './exec.js'

const idx = (o: Partial<IndexSpec> & { name: string }): IndexSpec => ({ keys: { done: 1 }, ...o })

const next = (o: Partial<CollectionProps> = {}): CollectionProps & { indexes: IndexSpec[] } => ({
	name: 'todos',
	indexes: [],
	...o,
})

const prior = (o: Partial<CollectionPrior> = {}): CollectionPrior => ({ indexes: [], ...o })

const schema = (required: string[]): Validator => ({
	$jsonSchema: { bsonType: 'object', required },
})

describe('buildCreateCollection', () => {
	it('creates without options when no validator is declared', () => {
		expect(buildCreateCollection({ name: 'todos' })).toBe(
			'if (!dbx.getCollectionNames().includes("todos")) {\n  dbx.createCollection("todos");\n}'
		)
	})

	it('adds a collMod branch when the collection already exists', () => {
		const js = buildCreateCollection({ name: 'todos', validator: schema(['title']) })
		expect(js).toContain('dbx.createCollection("todos", {"validator"')
		expect(js).toContain('} else {')
		expect(js).toContain('dbx.runCommand({"collMod":"todos"')
	})
})

describe('buildCreateIndex', () => {
	it('always names the index and omits unset options', () => {
		expect(buildCreateIndex('todos', idx({ name: 'idx_done' }))).toBe(
			'dbx.getCollection("todos").createIndex({"done":1}, {"name":"idx_done"});'
		)
	})

	it('carries unique and TTL options through', () => {
		const js = buildCreateIndex(
			'todos',
			idx({ name: 'idx_ttl', unique: true, expireAfterSeconds: 60 })
		)
		expect(js).toContain('"unique":true')
		expect(js).toContain('"expireAfterSeconds":60')
	})
})

describe('diffCollection — indexes', () => {
	it('is a no-op when nothing changed', () => {
		const i = idx({ name: 'idx_done' })
		const diff = diffCollection(next({ indexes: [i] }), prior({ indexes: [i] }))
		expect(diff.js).toEqual([])
		expect(diff.destructive).toEqual([])
	})

	it('creates a newly declared index, non-destructively', () => {
		const diff = diffCollection(next({ indexes: [idx({ name: 'idx_done' })] }), prior())
		expect(diff.addedIndexes).toHaveLength(1)
		expect(diff.js).toHaveLength(1)
		expect(diff.destructive).toEqual([])
	})

	it('drops an index that is no longer declared, and flags it destructive', () => {
		const diff = diffCollection(next(), prior({ indexes: [idx({ name: 'idx_done' })] }))
		expect(diff.droppedIndexes).toEqual(['idx_done'])
		expect(diff.destructive).toHaveLength(1)
		expect(diff.destructive[0]).toContain('dropIndex("idx_done")')
	})

	it('guards dropIndex with an existence check so a partial state cannot abort the script', () => {
		const diff = diffCollection(next(), prior({ indexes: [idx({ name: 'idx_done' })] }))
		expect(diff.js[0]).toContain('getIndexes().some')
	})

	it('rebuilds an index whose keys changed — drop before create', () => {
		const diff = diffCollection(
			next({ indexes: [idx({ name: 'idx_done', keys: { done: -1 } })] }),
			prior({ indexes: [idx({ name: 'idx_done', keys: { done: 1 } })] })
		)
		expect(diff.changedIndexes).toHaveLength(1)
		expect(diff.js[0]).toContain('dropIndex')
		expect(diff.js[1]).toContain('createIndex')
		expect(diff.destructive).toHaveLength(1)
	})

	it('treats a flipped unique flag as a rebuild, not a no-op', () => {
		const diff = diffCollection(
			next({ indexes: [idx({ name: 'idx_done', unique: true })] }),
			prior({ indexes: [idx({ name: 'idx_done' })] })
		)
		expect(diff.changedIndexes).toHaveLength(1)
	})
})

describe('diffCollection — validator', () => {
	it('emits collMod when the validator changed', () => {
		const diff = diffCollection(next({ validator: schema(['title']) }), prior())
		expect(diff.validatorChanged).toBe(true)
		expect(diff.js[0]).toContain('collMod')
	})

	it('flags adding a validator where there was none as destructive', () => {
		const diff = diffCollection(next({ validator: schema(['title']) }), prior())
		expect(diff.destructive).toHaveLength(1)
	})

	it('flags requiring a new field as destructive', () => {
		const diff = diffCollection(
			next({ validator: schema(['title', 'done']) }),
			prior({ validator: schema(['title']) })
		)
		expect(diff.destructive).toHaveLength(1)
	})

	it('does not flag relaxing a validator', () => {
		const diff = diffCollection(
			next({ validator: schema(['title']) }),
			prior({ validator: schema(['title', 'done']) })
		)
		expect(diff.validatorChanged).toBe(true)
		expect(diff.destructive).toEqual([])
	})

	it('does not flag dropping the validator entirely', () => {
		const diff = diffCollection(next(), prior({ validator: schema(['title']) }))
		expect(diff.destructive).toEqual([])
	})
})

describe('isValidatorTightened — enforcement level', () => {
	it('flags moderate → strict', () => {
		expect(
			isValidatorTightened(
				prior({ validator: schema(['title']), validationLevel: 'moderate' }),
				next({ validator: schema(['title']), validationLevel: 'strict' })
			)
		).toBe(true)
	})

	it('does not flag strict → moderate', () => {
		expect(
			isValidatorTightened(
				prior({ validator: schema(['title']), validationLevel: 'strict' }),
				next({ validator: schema(['title']), validationLevel: 'moderate' })
			)
		).toBe(false)
	})

	it('flags warn → error', () => {
		expect(
			isValidatorTightened(
				prior({ validator: schema(['title']), validationAction: 'warn' }),
				next({ validator: schema(['title']), validationAction: 'error' })
			)
		).toBe(true)
	})
})

describe('exec helpers', () => {
	it('binds the target database explicitly, ignoring the URI default', () => {
		expect(wrapScript('todos', 'dbx.foo.find();')).toBe(
			'const dbx = globalThis.db.getSiblingDB("todos");\ndbx.foo.find();'
		)
	})

	it('masks the password in a connection URI', () => {
		expect(redact(['mongodb://todos:hunter2@localhost:27017/todos'])).toEqual([
			'mongodb://todos:***@localhost:27017/todos',
		])
		expect(redact(['mongodb+srv://u:p@cluster.example.net/db'])).toEqual([
			'mongodb+srv://u:***@cluster.example.net/db',
		])
	})

	it('leaves a credential-free URI alone', () => {
		expect(redact(['mongodb://localhost:27017/todos'])).toEqual(['mongodb://localhost:27017/todos'])
	})
})
