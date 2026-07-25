import { type Ctx, type ResourceState, STATE_SCHEMA_VERSION, type StateFile } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import { type RefreshDeps, refreshState } from './refresh.js'

// refreshState is the pure core of `db-x refresh`. These tests drive it
// with hand-built state and fake specs, so they exercise the real drift logic
// (calling refresh, comparing outputs, updating state, skipping hookless
// components, isolating errors) without the JSX loader or live infrastructure.

function record(id: string, outputs: object, partial: Partial<ResourceState> = {}): ResourceState {
	return {
		id,
		kind: `test:${id}`,
		props: {},
		outputs,
		dependsOn: [],
		lastApplied: '2026-06-19T00:00:00.000Z',
		...partial,
	}
}

function stateOf(...records: ResourceState[]): StateFile {
	return {
		version: STATE_SCHEMA_VERSION,
		resources: Object.fromEntries(records.map((r) => [r.id, r])),
	}
}

// A no-op Ctx — the fake refresh hooks below ignore it entirely.
const CTX = {} as Ctx

type FakeRefresh = ((s: ResourceState) => Promise<object>) | undefined

/**
 * Build RefreshDeps from a map of kind → refresh impl. A kind mapped to
 * `undefined` models a registered component with no refresh hook; a kind
 * absent from the map models an unregistered kind (getSpec → undefined).
 */
function depsFrom(specs: Record<string, FakeRefresh>): RefreshDeps {
	return {
		getSpec: (kind) => {
			if (!(kind in specs)) return undefined
			const refresh = specs[kind]
			return refresh ? { refresh: (s) => refresh(s) } : {}
		},
		makeCtx: () => CTX,
	}
}

describe('refreshState', () => {
	it('flags drift and updates state outputs when refresh returns new data', async () => {
		const input = stateOf(record('db', { url: 'postgres://old' }, { kind: 'test:db' }))
		const deps = depsFrom({ 'test:db': async () => ({ url: 'postgres://new' }) })

		const { entries, state } = await refreshState(input, deps)

		expect(entries).toHaveLength(1)
		expect(entries[0]).toMatchObject({ id: 'db', status: 'drift' })
		expect(state.resources.db?.outputs).toEqual({ url: 'postgres://new' })
		// Input is never mutated.
		expect(input.resources.db?.outputs).toEqual({ url: 'postgres://old' })
	})

	it('reports in-sync and leaves outputs untouched when nothing changed', async () => {
		const input = stateOf(record('db', { url: 'postgres://same' }, { kind: 'test:db' }))
		const deps = depsFrom({ 'test:db': async () => ({ url: 'postgres://same' }) })

		const { entries, state } = await refreshState(input, deps)

		expect(entries[0]?.status).toBe('in-sync')
		expect(state.resources.db?.outputs).toEqual({ url: 'postgres://same' })
	})

	it('skips resources whose component defines no refresh hook', async () => {
		const input = stateOf(record('host', { ip: '10.0.0.1' }, { kind: 'test:host' }))
		const deps = depsFrom({ 'test:host': undefined })

		const { entries, state } = await refreshState(input, deps)

		expect(entries[0]?.status).toBe('skipped')
		expect(state.resources.host?.outputs).toEqual({ ip: '10.0.0.1' })
	})

	it('isolates a throwing refresh as an error without touching other resources', async () => {
		const input = stateOf(
			record('good', { v: 1 }, { kind: 'test:good' }),
			record('bad', { v: 2 }, { kind: 'test:bad' })
		)
		const deps = depsFrom({
			'test:good': async () => ({ v: 99 }),
			'test:bad': async () => {
				throw new Error('boom')
			},
		})

		const { entries, state } = await refreshState(input, deps)

		const good = entries.find((e) => e.id === 'good')
		const bad = entries.find((e) => e.id === 'bad')
		expect(good?.status).toBe('drift')
		expect(state.resources.good?.outputs).toEqual({ v: 99 })
		expect(bad).toMatchObject({ status: 'error', error: 'boom' })
		// A failed refresh must not alter that resource's persisted outputs.
		expect(state.resources.bad?.outputs).toEqual({ v: 2 })
	})

	it('returns no entries for empty state', async () => {
		const { entries } = await refreshState(stateOf(), depsFrom({}))
		expect(entries).toEqual([])
	})
})
