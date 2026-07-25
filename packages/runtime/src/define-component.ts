// `defineComponent` — the single contract every DB-X component extends.
//
// A component built with `defineComponent` is:
//   1. Callable as JSX: `<VercelProject name="foo" />` produces an ElementNode
//      via the JSX runtime in jsx-runtime.ts.
//   2. Branded with `__dbx.kind` so the reconciler can identify it
//      without invoking the function.
//   3. Registered globally so the executor can dispatch `apply` / `destroy`
//      hooks by kind.
//
// The returned function is intentionally non-callable. JSX never invokes
// the component function directly — the compiler always wraps it as
// `jsx(Component, props)`. Calling it directly is always a user error.

import type { Child, ElementNode } from './jsx-runtime.js'
import { registerComponent } from './registry.js'
import type { ComponentSpec } from './types.js'

export interface CommonProps {
	/** Override the auto-derived resource id. */
	id?: string
	/** Explicit dependency edges. Children implicitly depend on their parent. */
	dependsOn?: string[]
	children?: Child | Child[]
}

export type JSXComponent<TProps extends object> = ((
	props: TProps & CommonProps
) => ElementNode<TProps & CommonProps>) & {
	readonly __dbx: { readonly kind: string }
}

export function defineComponent<TProps extends object, TOutputs extends object = object>(
	spec: ComponentSpec<TProps, TOutputs>
): JSXComponent<TProps> {
	// Register on module load. Subsequent `import` of the same library reuses
	// this registration; duplicate kinds with different specs throw.
	registerComponent(
		spec.kind,
		spec as unknown as ComponentSpec<Record<string, unknown>, Record<string, unknown>>
	)

	const fn = (() => {
		throw new Error(`DB-X components are not callable directly. Use as JSX: <${spec.kind} ... />`)
	}) as unknown as JSXComponent<TProps>

	Object.defineProperty(fn, '__dbx', {
		value: Object.freeze({ kind: spec.kind }),
		writable: false,
		enumerable: false,
		configurable: false,
	})

	Object.defineProperty(fn, 'name', {
		value: spec.kind,
		writable: false,
		configurable: true,
	})

	return fn
}

/** Type guard: is this function value a component created by `defineComponent`? */
export function isDbXComponent(value: unknown): value is JSXComponent<object> {
	return (
		typeof value === 'function' &&
		'__dbx' in value &&
		typeof (value as { __dbx?: unknown }).__dbx === 'object'
	)
}
