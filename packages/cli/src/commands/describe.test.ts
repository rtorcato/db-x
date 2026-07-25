import { type Plan, type Resource, STATE_SCHEMA_VERSION, type StateFile } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, buildDescribe } from './describe.js'

// Tests below pin the JSON contract documented in docs/describe-schema.md.
// They drive buildDescribe with hand-built fixtures rather than loading real
// .tsx files, so they run fast and stay independent of the JSX loader.

const ARGS = { file: '/work/infra.tsx', workDir: '/work' }

function resource(id: string, kind: string, partial: Partial<Resource> = {}): Resource {
	return {
		id,
		kind,
		props: {},
		dependsOn: [],
		...partial,
	}
}

function stateOf(...records: StateFile['resources'][string][]): StateFile {
	return {
		version: STATE_SCHEMA_VERSION,
		resources: Object.fromEntries(records.map((r) => [r.id, r])),
	}
}

const EMPTY_STATE: StateFile = { version: STATE_SCHEMA_VERSION, resources: {} }

const EMPTY_PLAN: Plan = { actions: [] }

function planOf(...actions: Plan['actions']): Plan {
	return { actions }
}

describe('buildDescribe — schema envelope', () => {
	it('emits the documented top-level fields', () => {
		const out = buildDescribe(ARGS, {}, EMPTY_STATE, EMPTY_PLAN)
		expect(out.schema).toBe(SCHEMA_VERSION)
		expect(out.project).toEqual({ file: '/work/infra.tsx', workDir: '/work' })
		expect(out.summary).toEqual({
			totalResources: 0,
			byKind: {},
			byPhase: {},
			byAction: {},
		})
		expect(out.resources).toEqual([])
		// generatedAt is an ISO 8601 timestamp; just assert it parses.
		expect(Number.isFinite(Date.parse(out.generatedAt))).toBe(true)
	})

	it('keeps the schema version stable so consumers can pin on it', () => {
		expect(SCHEMA_VERSION).toBe('db-x.describe/v1')
	})
})

describe('buildDescribe — desired-only graph (everything is a create)', () => {
	const desired: Record<string, Resource> = {
		db: resource('db', 'pg:database', { phase: 'setup' }),
		api: resource('api', 'host:service', {
			phase: 'setup',
			dependsOn: ['db'],
		}),
	}
	const plan = planOf(
		{
			id: 'db',
			kind: 'pg:database',
			action: { type: 'create' },
			desired: desired.db!,
			current: null,
		},
		{
			id: 'api',
			kind: 'host:service',
			action: { type: 'create' },
			desired: desired.api!,
			current: null,
		}
	)

	it('marks both as inJsx, inState=false, and surfaces dependents', () => {
		const out = buildDescribe(ARGS, desired, EMPTY_STATE, plan)
		const db = out.resources.find((r) => r.id === 'db')
		const api = out.resources.find((r) => r.id === 'api')

		expect(db?.inJsx).toBe(true)
		expect(db?.inState).toBe(false)
		expect(db?.dependents).toEqual(['api'])
		expect(db?.action).toEqual({ type: 'create' })

		expect(api?.inJsx).toBe(true)
		expect(api?.inState).toBe(false)
		expect(api?.dependsOn).toEqual(['db'])
		expect(api?.dependents).toEqual([])
		expect(api?.action).toEqual({ type: 'create' })
	})

	it('summarizes by kind / phase / action', () => {
		const out = buildDescribe(ARGS, desired, EMPTY_STATE, plan)
		expect(out.summary.totalResources).toBe(2)
		expect(out.summary.byKind).toEqual({ 'pg:database': 1, 'host:service': 1 })
		expect(out.summary.byPhase).toEqual({ setup: 2 })
		expect(out.summary.byAction).toEqual({ create: 2 })
	})
})

describe('buildDescribe — drift (in state but no longer in JSX)', () => {
	const state = stateOf({
		id: 'orphan',
		kind: 'pg:database',
		props: { name: 'orphan' },
		outputs: { url: 'postgres://localhost/orphan' },
		dependsOn: [],
		lastApplied: '2026-06-19T00:00:00.000Z',
	})
	const plan = planOf({
		id: 'orphan',
		kind: 'pg:database',
		action: { type: 'destroy', reason: 'no longer declared' },
		desired: null,
		current: state.resources.orphan!,
	})

	it('flags inJsx=false, inState=true, with outputs surfaced', () => {
		const out = buildDescribe(ARGS, {}, state, plan)
		const r = out.resources[0]
		expect(r?.id).toBe('orphan')
		expect(r?.inJsx).toBe(false)
		expect(r?.inState).toBe(true)
		expect(r?.outputs).toEqual({ url: 'postgres://localhost/orphan' })
		expect(r?.lastApplied).toBe('2026-06-19T00:00:00.000Z')
		expect(r?.action).toEqual({ type: 'destroy', reason: 'no longer declared' })
	})
})

describe('buildDescribe — mixed (declared + persisted + no-op)', () => {
	const desired: Record<string, Resource> = {
		cache: resource('cache', 'redis:server', { phase: 'setup' }),
	}
	const state = stateOf({
		id: 'cache',
		kind: 'redis:server',
		props: {},
		outputs: { host: 'cache.internal' },
		dependsOn: [],
		phase: 'setup',
		lastApplied: '2026-06-19T00:00:00.000Z',
	})
	const plan = planOf({
		id: 'cache',
		kind: 'redis:server',
		action: { type: 'no-op' },
		desired: desired.cache!,
		current: state.resources.cache!,
	})

	it('marks the resource as both inJsx and inState with a no-op action', () => {
		const out = buildDescribe(ARGS, desired, state, plan)
		const r = out.resources[0]
		expect(r?.inJsx).toBe(true)
		expect(r?.inState).toBe(true)
		expect(r?.outputs).toEqual({ host: 'cache.internal' })
		expect(r?.action).toEqual({ type: 'no-op' })
		expect(out.summary.byAction).toEqual({ 'no-op': 1 })
	})
})

describe('buildDescribe — sorting', () => {
	it('orders by phase rank first, then by id alphabetically', () => {
		const desired: Record<string, Resource> = {
			'z-late': resource('z-late', 'kind:a', { phase: 'teardown' }),
			'a-late': resource('a-late', 'kind:a', { phase: 'teardown' }),
			unphased: resource('unphased', 'kind:a'),
			'b-setup': resource('b-setup', 'kind:a', { phase: 'setup' }),
			'a-setup': resource('a-setup', 'kind:a', { phase: 'setup' }),
		}
		const out = buildDescribe(ARGS, desired, EMPTY_STATE, EMPTY_PLAN)
		expect(out.resources.map((r) => r.id)).toEqual([
			'unphased', // phase rank 0
			'a-setup', // phase rank 1, id a < b
			'b-setup', // phase rank 1
			'a-late', // phase rank 4, id a < z
			'z-late', // phase rank 4
		])
	})
})

describe('buildDescribe — description prop pass-through', () => {
	it('extracts a string description prop into top-level description', () => {
		const desired: Record<string, Resource> = {
			thing: resource('thing', 'k:thing', {
				props: { description: 'the production thing' },
			}),
		}
		const out = buildDescribe(ARGS, desired, EMPTY_STATE, EMPTY_PLAN)
		expect(out.resources[0]?.description).toBe('the production thing')
	})

	it('returns null when description is missing or non-string', () => {
		const desired: Record<string, Resource> = {
			a: resource('a', 'k:a'),
			b: resource('b', 'k:b', { props: { description: 42 } }),
		}
		const out = buildDescribe(ARGS, desired, EMPTY_STATE, EMPTY_PLAN)
		expect(out.resources.find((r) => r.id === 'a')?.description).toBeNull()
		expect(out.resources.find((r) => r.id === 'b')?.description).toBeNull()
	})
})

describe('buildDescribe — JSON shape is serializable', () => {
	it('round-trips through JSON.parse(JSON.stringify(...)) unchanged', () => {
		const desired: Record<string, Resource> = {
			x: resource('x', 'k:x', { phase: 'setup', dependsOn: [] }),
		}
		const out = buildDescribe(ARGS, desired, EMPTY_STATE, EMPTY_PLAN)
		const round = JSON.parse(JSON.stringify(out))
		expect(round).toEqual(out)
	})
})
