// Phase — lifecycle grouping component.
//
// Unlike resources built with defineComponent, Phase does not produce a node
// in the resource graph. It is a *metadata wrapper*: the reconciler descends
// into its children with `phase` set on its render context, stamping that
// value onto every child resource it visits.
//
// This is why Phase has no apply/destroy and is not registered in the
// component registry. The runtime distinguishes it via the `__dbxPhase`
// brand on the function identity.

import type { Child, ElementNode } from './jsx-runtime.js'
import type { ELEMENT_TYPE } from './jsx-runtime.js'
import type { PhaseType } from './types.js'

export interface PhaseProps {
	/** Lifecycle stage these children belong to. */
	type: PhaseType
	/** Optional free-form tags surfaced by the CLI for filtering output. */
	tags?: readonly string[]
	children?: Child | Child[]
}

interface PhaseComponent {
	(props: PhaseProps): ElementNode<PhaseProps>
	readonly __dbxPhase: true
}

function createPhaseComponent(): PhaseComponent {
	// Like defineComponent's return, this is identity-only. Calling it directly
	// is always a user error — JSX compiles `<Phase>` to `jsx(Phase, props)`.
	const fn = (() => {
		throw new Error(
			'Phase is JSX-only; do not call directly. Use as <Phase type="setup">...</Phase>'
		)
	}) as unknown as PhaseComponent

	Object.defineProperty(fn, '__dbxPhase', {
		value: true as const,
		writable: false,
		enumerable: false,
		configurable: false,
	})

	Object.defineProperty(fn, 'name', {
		value: 'Phase',
		writable: false,
		configurable: true,
	})

	return fn
}

export const Phase: PhaseComponent = createPhaseComponent()

/** Type guard for the reconciler. */
export function isPhaseComponent(value: unknown): value is PhaseComponent {
	return (
		typeof value === 'function' &&
		'__dbxPhase' in value &&
		(value as PhaseComponent).__dbxPhase === true
	)
}

/** The four valid phase types, in apply order. */
export const PHASE_ORDER: readonly PhaseType[] = ['setup', 'monitoring', 'backup', 'teardown']

/** Re-emit ElementNode shape for completeness (matches Phase's JSX use). */
export type PhaseElement = ElementNode<PhaseProps> & {
	$$typeof: typeof ELEMENT_TYPE
}
