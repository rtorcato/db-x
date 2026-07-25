// Reconciler — walks a JSX ElementNode tree and produces a Graph.
//
// The tree contains four kinds of nodes:
//
//   1. Fragments               — descend into children, no resource produced
//   2. Phase wrappers          — descend with `phase` set on render context
//   3. defineComponent results — create a Resource, descend with `parent` set
//   4. User function components — invoke, then recurse on the returned tree
//
// Identity rules for resources:
//   - `props.id` wins if explicitly set
//   - else `<shortKind>:<props.name>` if `name` is a string
//   - else `<shortKind>#<sibling-index>` (deterministic, parent-scoped)
//
// `shortKind` is the last segment of the namespaced kind, e.g. `project`
// from `@vercel/db-x:project`. Collisions across packages with the same
// short kind and same name in the same scope require an explicit `id`.

import { isDbXComponent } from './define-component.js'
import type { Child, ElementNode } from './jsx-runtime.js'
import { ELEMENT_TYPE, Fragment } from './jsx-runtime.js'
import { isPhaseComponent } from './phase.js'
import { getComponentSpec } from './registry.js'
import type { Graph, PhaseType, Resource } from './types.js'

interface RenderCtx {
	resources: Record<string, Resource>
	parent: string | undefined
	phase: PhaseType | undefined
	/** Sibling-index counter scoped by `<kind>@<parent | 'root'>`. */
	siblingCounter: Map<string, number>
}

const META_PROPS = new Set(['id', 'dependsOn'])

export function renderToGraph(node: Child | Child[]): Graph {
	const ctx: RenderCtx = {
		resources: {},
		parent: undefined,
		phase: undefined,
		siblingCounter: new Map(),
	}
	walk(node, ctx)
	return { resources: ctx.resources, outputs: {} }
}

function walk(node: Child | Child[], ctx: RenderCtx): void {
	if (node == null) return
	if (typeof node === 'boolean') return
	if (typeof node === 'string' || typeof node === 'number') return

	if (Array.isArray(node)) {
		for (const child of node) walk(child, ctx)
		return
	}

	if (!isElementNode(node)) return

	const { type, props } = node

	// 1. Fragment
	if (type === Fragment) {
		walk(props.children, ctx)
		return
	}

	// 2. Phase wrapper
	if (isPhaseComponent(type)) {
		const phaseType = (props as unknown as { type: PhaseType }).type
		walk(props.children, { ...ctx, phase: phaseType })
		return
	}

	// 3. defineComponent-built resource
	if (isDbXComponent(type)) {
		const kind = type.__dbx.kind
		const spec = getComponentSpec(kind)
		if (!spec) {
			throw new Error(
				`Component spec not found for kind "${kind}". This is an internal error — defineComponent should have registered it.`
			)
		}

		const rawProps = props as Record<string, unknown>
		const mergedWithDefaults = { ...(spec.defaults ?? {}), ...rawProps }
		const validated = (
			spec.schema ? spec.schema.parse(mergedWithDefaults) : mergedWithDefaults
		) as Record<string, unknown>

		const id = deriveResourceId(kind, validated, ctx)
		if (ctx.resources[id]) {
			throw new Error(
				`Duplicate resource id "${id}". Provide an explicit \`id\` prop to disambiguate.`
			)
		}

		const resourceProps = stripMetaProps(validated)
		const dependsOn: string[] = []
		if (ctx.parent) dependsOn.push(ctx.parent)
		const explicit = rawProps.dependsOn
		if (Array.isArray(explicit)) {
			for (const dep of explicit) {
				if (typeof dep === 'string' && !dependsOn.includes(dep)) dependsOn.push(dep)
			}
		}

		const resource: Resource = {
			id,
			kind,
			props: resourceProps,
			dependsOn,
			parent: ctx.parent,
			phase: ctx.phase,
		}
		ctx.resources[id] = resource

		walk(props.children, { ...ctx, parent: id })
		return
	}

	// 4. User-defined function component (returns an ElementNode tree)
	if (typeof type === 'function') {
		let result: unknown
		try {
			result = (type as (props: Record<string, unknown>) => Child | Child[])(
				props as Record<string, unknown>
			)
		} catch (err) {
			throw new Error(`Function component threw during render: ${(err as Error).message ?? err}`)
		}
		walk(result as Child | Child[], ctx)
		return
	}

	// Anything else (string or unknown symbol type) is ignored — DB-X has no
	// HTML-like intrinsic elements.
}

function isElementNode(value: unknown): value is ElementNode {
	return (
		typeof value === 'object' &&
		value !== null &&
		'$$typeof' in value &&
		(value as { $$typeof?: unknown }).$$typeof === ELEMENT_TYPE
	)
}

function deriveResourceId(kind: string, props: Record<string, unknown>, ctx: RenderCtx): string {
	const explicit = props.id
	if (typeof explicit === 'string' && explicit.length > 0) return explicit

	const shortKind = kind.split(':').pop() ?? kind

	const name = props.name
	if (typeof name === 'string' && name.length > 0) return `${shortKind}:${name}`

	const slot = `${kind}@${ctx.parent ?? 'root'}`
	const idx = ctx.siblingCounter.get(slot) ?? 0
	ctx.siblingCounter.set(slot, idx + 1)
	return `${shortKind}#${idx}`
}

function stripMetaProps(props: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(props)) {
		if (META_PROPS.has(key)) continue
		if (key === 'children') {
			// Preserve primitive text content; drop element nodes (not JSON-serialisable).
			const items = Array.isArray(value) ? value : [value]
			const text = items
				.filter((c): c is string | number => typeof c === 'string' || typeof c === 'number')
				.map(String)
				.join('')
			if (text.length > 0) out.children = text
			continue
		}
		out[key] = value
	}
	return out
}
