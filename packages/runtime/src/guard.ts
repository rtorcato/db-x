// Destructive-change guard.
//
// Destructiveness is decided at plan time (each component's `plan` hook, or the
// diff engine for teardowns, populates `action.destructive`). This module turns
// that into an apply-time policy:
//   - `--allow-destructive` is the global opt-in; without it any destructive
//     action is blocked.
//   - `protect` on a resource (or any ancestor) hard-locks its subtree —
//     destructive changes are blocked even *with* the flag. Remove `protect`
//     from the JSX to proceed.

import type { Plan } from './diff.js'
import type { StateFile } from './state.js'
import type { Graph } from './types.js'

export type DestructiveBlockReason = 'protected' | 'needs-allow-destructive'

export interface DestructiveViolation {
	id: string
	kind: string
	reason: DestructiveBlockReason
	/** Human-readable destructive changes, from `action.destructive`. */
	changes: string[]
}

export interface DestructiveGuardOptions {
	allowDestructive: boolean
}

/**
 * True when `id`, or any ancestor, carries a truthy `protect` prop. Walks the
 * desired graph first and falls back to persisted state, so resources being
 * destroyed (absent from the graph) still resolve their protected ancestor.
 */
export function isProtected(id: string, graph: Graph, state: StateFile): boolean {
	const propsOf = (rid: string): Record<string, unknown> | undefined =>
		(graph.resources[rid]?.props ?? state.resources[rid]?.props) as
			| Record<string, unknown>
			| undefined
	const parentOf = (rid: string): string | undefined =>
		graph.resources[rid]?.parent ?? state.resources[rid]?.parent

	const seen = new Set<string>()
	let cursor: string | undefined = id
	while (cursor && !seen.has(cursor)) {
		seen.add(cursor)
		if (propsOf(cursor)?.protect === true) return true
		cursor = parentOf(cursor)
	}
	return false
}

/**
 * Scan a plan for destructive actions that must be blocked: any under a
 * `protect`-ed ancestor (blocked unconditionally), plus — when
 * `allowDestructive` is false — every other destructive action. An empty
 * result means the plan is safe to apply.
 */
export function findDestructiveViolations(
	plan: Plan,
	graph: Graph,
	state: StateFile,
	opts: DestructiveGuardOptions
): DestructiveViolation[] {
	const violations: DestructiveViolation[] = []
	for (const a of plan.actions) {
		const action = a.action
		const changes =
			action.type === 'update' || action.type === 'replace' || action.type === 'destroy'
				? action.destructive
				: undefined
		if (!changes || changes.length === 0) continue

		if (isProtected(a.id, graph, state)) {
			violations.push({ id: a.id, kind: a.kind, reason: 'protected', changes })
		} else if (!opts.allowDestructive) {
			violations.push({ id: a.id, kind: a.kind, reason: 'needs-allow-destructive', changes })
		}
	}
	return violations
}
