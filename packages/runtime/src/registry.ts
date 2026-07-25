// Internal global registry mapping component `kind` → `ComponentSpec`.
//
// `defineComponent` writes to this on module load (when a library is
// imported). The reconciler / executor read from it later to dispatch
// lifecycle hooks. There is no central library registry on disk — imports
// drive registration, just like any other npm package.
//
// The registry is stored on `globalThis` so it survives the case where the
// runtime module gets evaluated more than once (e.g. when the CLI loads
// user code through `tsx`'s loader, which creates a separate ESM graph from
// the CLI's own imports). Without this, the CLI and user-loaded library
// would each get their own Map and lookups would fail.

import type { ComponentSpec } from './types.js'

// Using an `unknown`-typed value inside the map because the registry is
// kind-keyed and erases per-component generics. Callers cast back to a
// specific spec shape via the kind.
type AnySpec = ComponentSpec<Record<string, unknown>, Record<string, unknown>>

const REGISTRY_KEY = Symbol.for('@db-x/runtime.registry')

interface GlobalWithRegistry {
	[REGISTRY_KEY]?: Map<string, AnySpec>
}

const globalSlot = globalThis as GlobalWithRegistry
const existingRegistry = globalSlot[REGISTRY_KEY]
const registry: Map<string, AnySpec> = existingRegistry ?? new Map<string, AnySpec>()
if (!existingRegistry) {
	globalSlot[REGISTRY_KEY] = registry
}

export function registerComponent(kind: string, spec: AnySpec): void {
	const existing = registry.get(kind)
	if (existing && existing !== spec) {
		throw new Error(
			`Duplicate component kind: "${kind}". Two defineComponent calls used the same kind, or the same module was loaded twice via different paths.`
		)
	}
	registry.set(kind, spec)
}

export function getComponentSpec(kind: string): AnySpec | undefined {
	return registry.get(kind)
}

export function listComponents(): string[] {
	return Array.from(registry.keys()).sort()
}

/** Test-only: wipe the registry between tests. */
export function clearRegistry(): void {
	registry.clear()
}
