// @db-x/runtime — public entry point.
//
// Exports the JSX runtime, the `defineComponent` contract, the Phase
// component, the reconciler, the diff engine, the state I/O layer, and
// every type a third-party library or the CLI consumes.

export { ELEMENT_TYPE, Fragment, jsx, jsxs } from './jsx-runtime.js'
export type { AnyElement, Child, ElementNode, ElementType, Props } from './jsx-runtime.js'

export { defineComponent, isDbXComponent } from './define-component.js'
export type { CommonProps, JSXComponent } from './define-component.js'

export { isPhaseComponent, Phase, PHASE_ORDER } from './phase.js'
export type { PhaseElement, PhaseProps } from './phase.js'

export { getComponentSpec, listComponents } from './registry.js'

export { renderToGraph } from './reconciler.js'

export { plan, reverseForDestroy } from './diff.js'
export type { Plan, ResourceDiff } from './diff.js'

export {
	acquireLock,
	emptyState,
	LOCK_FILE,
	readState,
	STATE_DIR,
	STATE_FILE,
	STATE_SCHEMA_VERSION,
	withLock,
	writeState,
} from './state.js'
export type { LockHandle, StateFile } from './state.js'

export type {
	ComponentSpec,
	Ctx,
	CtxLogger,
	Graph,
	PhaseType,
	PlanAction,
	Resource,
	ResourceMeta,
	ResourceState,
	RuntimeExec,
	Schema,
} from './types.js'
