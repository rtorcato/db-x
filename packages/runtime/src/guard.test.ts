import { describe, expect, it } from 'vitest'
import type { Plan, ResourceDiff } from './diff.js'
import { findDestructiveViolations, isProtected } from './guard.js'
import type { StateFile } from './state.js'
import type { Graph, PlanAction, Resource } from './types.js'

const res = (id: string, over: Partial<Resource> = {}): Resource => ({
	id,
	kind: 'test:thing',
	props: {},
	dependsOn: [],
	...over,
})

const graphOf = (...resources: Resource[]): Graph => ({
	resources: Object.fromEntries(resources.map((r) => [r.id, r])),
	outputs: {},
})

const emptyState: StateFile = { version: 1, resources: {} }

const diff = (id: string, action: PlanAction): ResourceDiff => ({
	id,
	kind: 'test:thing',
	action,
	desired: null,
	current: null,
})

const planOf = (...actions: ResourceDiff[]): Plan => ({ actions })

describe('isProtected', () => {
	it('is false when neither the resource nor an ancestor has protect', () => {
		const graph = graphOf(res('db'), res('t', { parent: 'db' }))
		expect(isProtected('t', graph, emptyState)).toBe(false)
	})

	it('is true when the resource itself has protect', () => {
		const graph = graphOf(res('db', { props: { protect: true } }))
		expect(isProtected('db', graph, emptyState)).toBe(true)
	})

	it('is true when an ancestor has protect', () => {
		const graph = graphOf(
			res('db', { props: { protect: true } }),
			res('t', { parent: 'db' }),
			res('c', { parent: 't' })
		)
		expect(isProtected('c', graph, emptyState)).toBe(true)
	})

	it('resolves protect via persisted state for a destroyed resource absent from the graph', () => {
		// `t` was removed from the JSX (not in graph) but its protected parent
		// `db` still is; state carries the parent link.
		const graph = graphOf(res('db', { props: { protect: true } }))
		const state: StateFile = {
			version: 1,
			resources: {
				t: {
					id: 't',
					kind: 'test:thing',
					props: {},
					outputs: {},
					dependsOn: [],
					parent: 'db',
					lastApplied: '',
				},
			},
		}
		expect(isProtected('t', graph, state)).toBe(true)
	})

	it('only treats protect === true as protecting (not truthy strings)', () => {
		const graph = graphOf(res('db', { props: { protect: 'yes' } }))
		expect(isProtected('db', graph, emptyState)).toBe(false)
	})
})

describe('findDestructiveViolations', () => {
	it('returns nothing for non-destructive actions', () => {
		const plan = planOf(
			diff('a', { type: 'create' }),
			diff('b', { type: 'update', reason: 'add column' }),
			diff('c', { type: 'no-op' })
		)
		expect(
			findDestructiveViolations(plan, graphOf(), emptyState, { allowDestructive: false })
		).toEqual([])
	})

	it('blocks a destructive action when --allow-destructive is absent', () => {
		const plan = planOf(diff('t', { type: 'update', reason: 'x', destructive: ['DROP INDEX "i"'] }))
		const graph = graphOf(res('t'))
		const v = findDestructiveViolations(plan, graph, emptyState, { allowDestructive: false })
		expect(v).toEqual([
			{
				id: 't',
				kind: 'test:thing',
				reason: 'needs-allow-destructive',
				changes: ['DROP INDEX "i"'],
			},
		])
	})

	it('permits a destructive action on an unprotected resource with the flag', () => {
		const plan = planOf(diff('t', { type: 'update', reason: 'x', destructive: ['DROP INDEX "i"'] }))
		const graph = graphOf(res('t'))
		expect(findDestructiveViolations(plan, graph, emptyState, { allowDestructive: true })).toEqual(
			[]
		)
	})

	it('blocks a protected destructive action EVEN WITH the flag', () => {
		const plan = planOf(diff('t', { type: 'update', reason: 'x', destructive: ['ALTER TYPE'] }))
		const graph = graphOf(res('db', { props: { protect: true } }), res('t', { parent: 'db' }))
		const v = findDestructiveViolations(plan, graph, emptyState, { allowDestructive: true })
		expect(v).toEqual([
			{ id: 't', kind: 'test:thing', reason: 'protected', changes: ['ALTER TYPE'] },
		])
	})

	it('flags a destroy action as destructive', () => {
		const plan = planOf(
			diff('t', { type: 'destroy', reason: 'gone', destructive: ['destroy test:thing "t"'] })
		)
		const v = findDestructiveViolations(plan, graphOf(), emptyState, { allowDestructive: false })
		expect(v.map((x) => x.reason)).toEqual(['needs-allow-destructive'])
	})
})
