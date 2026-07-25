// Diff engine — compares the desired graph against persisted state and
// produces an ordered Plan of resource actions.
//
// Output ordering:
//   - Topologically sorted within each phase
//   - Phases run setup → monitoring → backup → teardown (apply order)
//   - Unphased resources run before any phased ones
//
// For `destroy` the CLI iterates `reverseForDestroy(plan).actions` —
// dependents are torn down before their dependencies, and within each phase
// the order reverses. Teardown-phase resources are a special case the
// executor handles (their `apply` runs during destroy as cleanup hooks);
// the diff itself treats them like any other resource.

import { getComponentSpec } from './registry.js'
import type { StateFile } from './state.js'
import type { Graph, PhaseType, PlanAction, Resource, ResourceState } from './types.js'

export interface ResourceDiff {
	id: string
	kind: string
	action: PlanAction
	/** The desired Resource. Null when the action is a `destroy` of a state-only resource. */
	desired: Resource | null
	/** The persisted state. Null when the action is a `create`. */
	current: ResourceState | null
}

export interface Plan {
	actions: ResourceDiff[]
}

const PHASE_RANK: Record<PhaseType | 'unphased', number> = {
	unphased: 0,
	setup: 1,
	monitoring: 2,
	backup: 3,
	teardown: 4,
}

function rankOf(phase: PhaseType | undefined): number {
	return phase ? PHASE_RANK[phase] : PHASE_RANK.unphased
}

export function plan(desired: Graph, state: StateFile): Plan {
	const actions: ResourceDiff[] = []
	const ordered = topoSort(desired)
	const seen = new Set<string>()

	for (const id of ordered) {
		seen.add(id)
		const resource = desired.resources[id]
		if (!resource) continue
		const current = state.resources[id] ?? null

		const spec = getComponentSpec(resource.kind)
		if (!spec) {
			throw new Error(
				`Unknown component kind "${resource.kind}" for resource "${id}". Did you import the library that defines it?`
			)
		}

		const action: PlanAction = spec.plan
			? spec.plan(
					resource.props as Parameters<NonNullable<typeof spec.plan>>[0],
					current as Parameters<NonNullable<typeof spec.plan>>[1]
				)
			: defaultPlan(resource.props, current)

		actions.push({ id, kind: resource.kind, action, desired: resource, current })
	}

	for (const id of Object.keys(state.resources)) {
		if (seen.has(id)) continue
		const current = state.resources[id]
		if (!current) continue
		actions.push({
			id,
			kind: current.kind,
			action: { type: 'destroy', reason: 'resource no longer present in JSX' },
			desired: null,
			current,
		})
	}

	// Stable sort by phase rank. Array.prototype.sort is stable in all current
	// Node versions, so topo order within a phase is preserved.
	actions.sort((a, b) => {
		const pa = a.desired?.phase ?? a.current?.phase
		const pb = b.desired?.phase ?? b.current?.phase
		return rankOf(pa) - rankOf(pb)
	})

	return { actions }
}

function defaultPlan(props: Record<string, unknown>, state: ResourceState | null): PlanAction {
	if (!state) return { type: 'create' }
	return JSON.stringify(props) === JSON.stringify(state.props)
		? { type: 'no-op' }
		: { type: 'update', reason: 'props changed' }
}

function topoSort(graph: Graph): string[] {
	const visited = new Set<string>()
	const visiting = new Set<string>()
	const order: string[] = []

	const visit = (id: string): void => {
		if (visited.has(id)) return
		if (visiting.has(id)) {
			throw new Error(`Dependency cycle detected involving resource "${id}"`)
		}
		visiting.add(id)
		const resource = graph.resources[id]
		if (resource) {
			for (const depId of resource.dependsOn) {
				if (graph.resources[depId]) visit(depId)
			}
		}
		visiting.delete(id)
		visited.add(id)
		order.push(id)
	}

	for (const id of Object.keys(graph.resources)) {
		visit(id)
	}

	return order
}

/** Reverse the action list for `destroy` iteration. */
export function reverseForDestroy(plan: Plan): Plan {
	return { actions: [...plan.actions].reverse() }
}
