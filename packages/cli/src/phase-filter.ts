// Phase validation and plan filtering shared by `apply` and `destroy`.
//
// Two responsibilities:
//   1. validatePhase(input): coerce a raw user-supplied string into a
//      PhaseType, or fail fast with a useful message if it isn't one of the
//      known phases. Returns undefined when nothing was supplied.
//   2. filterByPhase(plan, phase, opts): return a new plan whose actions are
//      scoped to the target phase. `apply` and `destroy` differ on whether
//      to include unphased resources when a phase is set (see opts.
//      includeUnphasedWhenScoped).

import { PHASE_ORDER, type PhaseType, type Plan } from '@db-x/runtime'

export function validatePhase(input: string | undefined): PhaseType | undefined {
	if (input === undefined || input === '') return undefined
	if ((PHASE_ORDER as readonly string[]).includes(input)) {
		return input as PhaseType
	}
	const allowed = PHASE_ORDER.join(', ')
	throw new Error(`Unknown --phase value "${input}". Expected one of: ${allowed}.`)
}

export interface FilterByPhaseOptions {
	/**
	 * When true (default), unphased resources are always included alongside the
	 * scoped phase. `apply` uses this because unphased resources (e.g. <Host>
	 * declared outside any <Phase>) carry outputs other resources depend on.
	 *
	 * When false, only resources whose phase matches the target are kept.
	 * `destroy` uses this so a --phase-scoped teardown doesn't accidentally
	 * destroy unphased resources that later phases still depend on.
	 */
	includeUnphasedWhenScoped?: boolean
}

export function filterByPhase(
	plan: Plan,
	phase: PhaseType | undefined,
	opts: FilterByPhaseOptions = {}
): Plan {
	// No --phase → run the full plan.
	if (phase === undefined) return plan

	const includeUnphased = opts.includeUnphasedWhenScoped ?? true

	return {
		...plan,
		actions: plan.actions.filter((a) => {
			const actionPhase = a.desired?.phase ?? a.current?.phase
			if (actionPhase === undefined) return includeUnphased
			return actionPhase === phase
		}),
	}
}
