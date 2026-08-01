import { getComponentSpec } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import {
	type CollectionPrior,
	type CollectionProps,
	type IndexSpec,
	type Validator,
	buildCreateCollection,
	buildCreateIndex,
	diffCollection,
	introspectExpression,
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

describe('CollectionResource.apply — outputs record what ran, not what was wanted', () => {
	const spec = getComponentSpec('@db-x/mongodb-library:collection')
	if (!spec?.apply)
		throw new Error('mongo collection component is not registered with an apply hook')
	const applyHook = spec.apply as (
		p: object,
		c: object,
		s: object | null
	) => Promise<{ indexes: IndexSpec[] }>

	// `true` stands in for mongosh: the index-create loop always runs, so the
	// apply does spawn — it just must not touch a database to prove the point.
	const ctx = {
		resource: { id: 'collection:users', parent: 'mongo:db' },
		deps: {
			'mongo:db': {
				database: 'app',
				uri: 'mongodb://localhost:27017',
				exec: { command: 'true', args: [] },
			},
		},
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		workDir: '/tmp',
		signal: new AbortController().signal,
	}

	// The wedge this guards (#89): a props change that emits no JS used to
	// persist the *desired* shape, so state described a collection that did not
	// exist. An index `description` is the cosmetic change that gets there —
	// `indexShape` ignores it, so the diff has nothing to run.
	it('keeps the last-applied shape when the diff emitted no JS', async () => {
		const live: IndexSpec = { name: 'idx_done', keys: { done: 1 } }
		const props = {
			name: 'users',
			indexes: [{ ...live, description: 'now documented' }],
		}
		const priorState = {
			props: { name: 'users', indexes: [live] },
			outputs: { name: 'users', indexes: [live] },
		}
		const outputs = await applyHook(props, ctx, priorState)
		expect(outputs.indexes[0].description).toBeUndefined()
	})
})

describe('introspectExpression', () => {
	// `getIndexes()` on a collection that isn't there throws, and a drift check
	// that dies is worse than one that reports absence.
	it('guards the index read behind an existence check', () => {
		const js = introspectExpression('todos')
		expect(js).toContain('getCollectionNames().includes("todos")')
		expect(js).toContain('exists: false, indexes: []')
	})
})

describe('CollectionResource.refresh — introspection to outputs', () => {
	const spec = getComponentSpec('@db-x/mongodb-library:collection')
	if (!spec?.refresh) throw new Error('mongodb collection component has no refresh hook')
	const refreshHook = spec.refresh as (
		s: object,
		c: object
	) => Promise<{ indexes: IndexSpec[]; missing?: boolean }>

	/** Stands in for mongosh: `sh -c` prints whatever the test wants back. */
	const ctxReturning = (json: string) => ({
		resource: { id: 'collection:todos', parent: 'mongo:db' },
		deps: {
			'mongo:db': {
				database: 'app',
				uri: 'mongodb://localhost',
				exec: { command: 'sh', args: ['-c', 'printf %s "$DBX_OUT"'], env: { DBX_OUT: json } },
			},
		},
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		workDir: '/tmp',
		signal: new AbortController().signal,
	})

	const stateOf = (indexes: IndexSpec[], extra: Record<string, unknown> = {}) => ({
		props: {},
		outputs: { name: 'todos', indexes, ...extra },
	})

	const idx: IndexSpec = { name: 'idx_done', keys: { done: 1 } }

	it('reports no drift when live index names match', async () => {
		const stored = [idx]
		const outputs = await refreshHook(
			stateOf(stored),
			ctxReturning('{"exists":true,"indexes":[{"name":"_id_"},{"name":"idx_done"}]}')
		)
		expect(outputs.indexes).toEqual(stored)
		expect(outputs.missing).toBeUndefined()
	})

	// `_id_` is Mongo's own and undroppable — counting it as drift would make
	// every refresh report a change.
	it('ignores the built-in _id_ index', async () => {
		const outputs = await refreshHook(
			stateOf([]),
			ctxReturning('{"exists":true,"indexes":[{"name":"_id_"}]}')
		)
		expect(outputs.indexes).toEqual([])
	})

	it('drops a hand-deleted index from outputs so the diff re-adds it', async () => {
		const outputs = await refreshHook(
			stateOf([idx, { name: 'idx_gone', keys: { x: 1 } }]),
			ctxReturning('{"exists":true,"indexes":[{"name":"_id_"},{"name":"idx_done"}]}')
		)
		expect(outputs.indexes).toEqual([idx])
	})

	it('marks a dropped collection missing, not merely index-less', async () => {
		const outputs = await refreshHook(stateOf([idx]), ctxReturning('{"exists":false,"indexes":[]}'))
		expect(outputs.missing).toBe(true)
		expect(outputs.indexes).toEqual([])
	})

	// Otherwise the plan would keep insisting on a create after the collection
	// came back.
	it('clears a stale missing flag once the collection is there again', async () => {
		const outputs = await refreshHook(
			stateOf([idx], { missing: true }),
			ctxReturning('{"exists":true,"indexes":[{"name":"_id_"},{"name":"idx_done"}]}')
		)
		expect(outputs.missing).toBeUndefined()
	})

	it('records an unauthored index with no keys', async () => {
		const outputs = await refreshHook(
			stateOf([idx]),
			ctxReturning('{"exists":true,"indexes":[{"name":"idx_done"},{"name":"idx_stray"}]}')
		)
		expect(outputs.indexes).toEqual([idx, { name: 'idx_stray', keys: {} }])
	})

	it('reports the collection missing when the read itself fails', async () => {
		const ctx = ctxReturning('')
		ctx.deps['mongo:db'].exec = { command: 'false', args: [], env: {} }
		const outputs = await refreshHook(stateOf([idx]), ctx)
		expect(outputs.missing).toBe(true)
	})
})
