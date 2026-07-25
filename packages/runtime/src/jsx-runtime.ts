// Minimal JSX runtime for DB-X.
//
// User JSX files compile against `jsxImportSource: "@db-x/runtime"`, which
// makes the TypeScript compiler emit calls to `jsx()` / `jsxs()` from this
// module. We do NOT depend on React or React DOM. An "element" here is a
// plain `ElementNode` object that the reconciler later walks into a resource
// graph — see packages/runtime/src/reconciler.ts (forthcoming).

export const ELEMENT_TYPE = Symbol.for('infra.jsx.element')
export const Fragment = Symbol.for('infra.jsx.fragment')

/**
 * Structural supertype every `ElementNode<T>` satisfies. Used in positions
 * that need to accept JSX from concretely-typed components (Child arrays,
 * JSX.Element) without running into the contravariance of `ElementType<T>`.
 */
export interface AnyElement {
	$$typeof: typeof ELEMENT_TYPE
	type: unknown
	props: unknown
	key: string | null
}

export type Child = AnyElement | string | number | boolean | null | undefined

export type Props = Record<string, unknown> & { children?: Child | Child[] }

export type ElementType<P = object> = ((props: P) => unknown) | typeof Fragment | symbol

export interface ElementNode<T extends object = Record<string, unknown>> {
	$$typeof: typeof ELEMENT_TYPE
	type: ElementType<T>
	props: T & { children: Child[] }
	key: string | null
}

function normalizeChildren(children: unknown): Child[] {
	if (children == null) return []
	return Array.isArray(children) ? (children as Child[]) : [children as Child]
}

export function jsx<T extends object>(
	type: ElementType<T>,
	props: T & { children?: Child | Child[] },
	key?: string
): ElementNode<T> {
	const { children, ...rest } = props as T & { children?: Child | Child[] }
	return {
		$$typeof: ELEMENT_TYPE,
		type,
		props: { ...(rest as T), children: normalizeChildren(children) },
		key: key ?? null,
	}
}

// React 17+ JSX transform calls `jsxs` for elements with static children
// arrays (multiple children) and `jsx` for elements with a single child or
// none. For our purposes the shape is identical.
export const jsxs = jsx

// JSX namespace consumed by TypeScript when `jsxImportSource` points here.
// `IntrinsicElements` is intentionally empty — DB-X has no HTML-like
// built-ins; every element is a component defined via `defineComponent`.
//
// `Element` is intentionally loose. A component returns `ElementNode<TProps>`
// where `TProps` is concrete (e.g. `PhaseProps`). For TypeScript to accept
// that return type as a JSX element, `JSX.Element` must be a structural
// supertype of every concrete `ElementNode<T>`. Pinning `type` / `props` to
// concrete shapes here would re-introduce the contravariance problem that
// breaks `<Phase>`, `<DockerCompose>`, etc.
export namespace JSX {
	export interface Element extends AnyElement {}
	// biome-ignore lint/suspicious/noEmptyInterface: TS JSX namespace requires an `IntrinsicElements` interface; DB-X has no HTML built-ins so it stays empty by design.
	export interface IntrinsicElements {}
	export interface ElementChildrenAttribute {
		children: object
	}
}
