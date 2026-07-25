import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent } from './define-component.js'
import { plan, reverseForDestroy } from './diff.js'
import { jsx } from './jsx-runtime.js'
import { Phase } from './phase.js'
import { renderToGraph } from './reconciler.js'
import { clearRegistry } from './registry.js'
import { STATE_SCHEMA_VERSION, type StateFile, emptyState } from './state.js'
import type { ComponentSpec, PlanAction, ResourceState } from './types.js'

type AnySpec = ComponentSpec<Record<string, unknown>, Record<string, unknown>>

function makeSpec(kind: string, extras: Partial<AnySpec> = {}): AnySpec {
	return {
		kind,
		apply: () => Promise.resolve({}),
		destroy: () => Promise.resolve(),
		...extras,
	}
}

function buildState(...resources: ResourceState[]): StateFile {
	return {
		version: STATE_SCHEMA_VERSION,
		resources: Object.fromEntries(resources.map((r) => [r.id, r])),
	}
}

function pastState(
	id: string,
	kind: string,
	props: Record<string, unknown>,
	extras: Partial<ResourceState> = {}
): ResourceState {
	return {
		id,
		kind,
		props,
		outputs: {},
		dependsOn: [],
		lastApplied: '2026-05-20T00:00:00Z',
		...extras,
	}
}

describe('plan', () => {
	beforeEach(() => {
		clearRegistry()
	})

	it('produces create actions for resources not yet in state', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'a' }))
		const p = plan(graph, emptyState())
		expect(p.actions).toHaveLength(1)
		expect(p.actions[0]?.action.type).toBe('create')
	})

	it('produces no-op when props are unchanged', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'a', region: 'us' }))
		const state = buildState(pastState('foo:a', 'test:foo', { name: 'a', region: 'us' }))
		const p = plan(graph, state)
		expect(p.actions[0]?.action.type).toBe('no-op')
	})

	it('produces update when props differ', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'a', region: 'us' }))
		const state = buildState(pastState('foo:a', 'test:foo', { name: 'a', region: 'eu' }))
		const p = plan(graph, state)
		expect(p.actions[0]?.action.type).toBe('update')
	})

	it('produces destroy for resources in state but not in desired', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'a' }))
		const state = buildState(
			pastState('foo:a', 'test:foo', { name: 'a' }),
			pastState('foo:gone', 'test:foo', { name: 'gone' })
		)
		const p = plan(graph, state)
		const destroy = p.actions.find((a) => a.id === 'foo:gone')
		expect(destroy?.action.type).toBe('destroy')
		expect(destroy?.desired).toBeNull()
	})

	it('uses a component-provided plan() if present', () => {
		const customPlan = (): PlanAction => ({ type: 'replace', reason: 'always-replace' })
		const Foo = defineComponent(makeSpec('test:foo', { plan: customPlan }))
		const graph = renderToGraph(jsx(Foo, { name: 'a' }))
		const state = buildState(pastState('foo:a', 'test:foo', { name: 'a' }))
		const p = plan(graph, state)
		expect(p.actions[0]?.action).toEqual({ type: 'replace', reason: 'always-replace' })
	})

	it('throws on unknown component kind during diff', () => {
		const graph = {
			resources: {
				'orphan:x': {
					id: 'orphan:x',
					kind: 'nonexistent:thing',
					props: {},
					dependsOn: [],
				},
			},
			outputs: {},
		}
		expect(() => plan(graph, emptyState())).toThrow(/Unknown component kind/)
	})

	it('orders actions topologically (dependencies before dependents)', () => {
		const Project = defineComponent(makeSpec('test:project'))
		const Domain = defineComponent(makeSpec('test:domain'))
		const graph = renderToGraph(jsx(Project, { name: 'p', children: jsx(Domain, { name: 'd' }) }))
		const p = plan(graph, emptyState())
		const projectIdx = p.actions.findIndex((a) => a.id === 'project:p')
		const domainIdx = p.actions.findIndex((a) => a.id === 'domain:d')
		expect(projectIdx).toBeLessThan(domainIdx)
	})

	it('orders by phase: setup → monitoring → backup', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		const Baz = defineComponent(makeSpec('test:baz'))
		const graph = renderToGraph([
			jsx(Phase, { type: 'backup', children: jsx(Foo, { name: 'a' }) }),
			jsx(Phase, { type: 'monitoring', children: jsx(Bar, { name: 'b' }) }),
			jsx(Phase, { type: 'setup', children: jsx(Baz, { name: 'c' }) }),
		])
		const p = plan(graph, emptyState())
		expect(p.actions.map((a) => a.id)).toEqual(['baz:c', 'bar:b', 'foo:a'])
	})

	it('places unphased resources before phased ones', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		const graph = renderToGraph([
			jsx(Phase, { type: 'setup', children: jsx(Foo, { name: 'phased' }) }),
			jsx(Bar, { name: 'unphased' }),
		])
		const p = plan(graph, emptyState())
		expect(p.actions.map((a) => a.id)).toEqual(['bar:unphased', 'foo:phased'])
	})

	it('places teardown-phase resources last', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		const graph = renderToGraph([
			jsx(Phase, { type: 'teardown', children: jsx(Foo, { name: 'late' }) }),
			jsx(Phase, { type: 'setup', children: jsx(Bar, { name: 'early' }) }),
		])
		const p = plan(graph, emptyState())
		expect(p.actions.map((a) => a.id)).toEqual(['bar:early', 'foo:late'])
	})

	it('detects dependency cycles', () => {
		const graph = {
			resources: {
				a: { id: 'a', kind: 'test:foo', props: {}, dependsOn: ['b'] },
				b: { id: 'b', kind: 'test:foo', props: {}, dependsOn: ['a'] },
			},
			outputs: {},
		}
		expect(() => plan(graph, emptyState())).toThrow(/cycle detected/i)
	})

	it('preserves phase from state when only the destroy action remains', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'keep' }))
		const state = buildState(
			pastState('foo:keep', 'test:foo', { name: 'keep' }),
			pastState('foo:gone-monitoring', 'test:foo', { name: 'g' }, { phase: 'monitoring' }),
			pastState('foo:gone-setup', 'test:foo', { name: 'g2' }, { phase: 'setup' })
		)
		const p = plan(graph, state)
		const destroys = p.actions.filter((a) => a.action.type === 'destroy')
		const ids = destroys.map((a) => a.id)
		// setup phase comes before monitoring phase by rank
		expect(ids.indexOf('foo:gone-setup')).toBeLessThan(ids.indexOf('foo:gone-monitoring'))
	})
})

describe('reverseForDestroy', () => {
	beforeEach(() => {
		clearRegistry()
	})

	it('reverses action order for destroy iteration', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		const graph = renderToGraph(jsx(Foo, { name: 'p', children: jsx(Bar, { name: 'c' }) }))
		const original = plan(graph, emptyState())
		const reversed = reverseForDestroy(original)
		expect(reversed.actions.map((a) => a.id)).toEqual(
			[...original.actions].reverse().map((a) => a.id)
		)
	})

	it('does not mutate the original plan', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'a' }))
		const original = plan(graph, emptyState())
		const snapshot = original.actions.map((a) => a.id)
		reverseForDestroy(original)
		expect(original.actions.map((a) => a.id)).toEqual(snapshot)
	})
})
