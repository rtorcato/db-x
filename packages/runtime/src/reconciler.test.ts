import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent } from './define-component.js'
import { jsx } from './jsx-runtime.js'
import { Phase } from './phase.js'
import { renderToGraph } from './reconciler.js'
import { clearRegistry } from './registry.js'
import type { ComponentSpec } from './types.js'

type AnySpec = ComponentSpec<Record<string, unknown>, Record<string, unknown>>

function makeSpec(kind: string, extras: Partial<AnySpec> = {}): AnySpec {
	return {
		kind,
		apply: () => Promise.resolve({}),
		destroy: () => Promise.resolve(),
		...extras,
	}
}

describe('renderToGraph', () => {
	beforeEach(() => {
		clearRegistry()
	})

	it('renders a single resource with name-derived id', () => {
		const Bucket = defineComponent(makeSpec('@aws/db-x:s3-bucket'))
		const graph = renderToGraph(jsx(Bucket, { name: 'my-bucket' }))
		expect(Object.keys(graph.resources)).toEqual(['s3-bucket:my-bucket'])
		expect(graph.resources['s3-bucket:my-bucket']?.props).toEqual({ name: 'my-bucket' })
	})

	it('uses explicit id when provided', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { id: 'custom-id', name: 'unused' }))
		expect(graph.resources['custom-id']).toBeDefined()
		expect(graph.resources['custom-id']?.props).not.toHaveProperty('id')
	})

	it('falls back to sibling-index id when no name or id', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { color: 'red' }))
		expect(Object.keys(graph.resources)).toEqual(['foo#0'])
	})

	it('tracks parent on nested children and adds implicit dependsOn', () => {
		const Project = defineComponent(makeSpec('test:project'))
		const Domain = defineComponent(makeSpec('test:domain'))
		const graph = renderToGraph(
			jsx(Project, { name: 'app', children: jsx(Domain, { name: 'app.com' }) })
		)
		expect(graph.resources['project:app']?.parent).toBeUndefined()
		expect(graph.resources['domain:app.com']?.parent).toBe('project:app')
		expect(graph.resources['domain:app.com']?.dependsOn).toEqual(['project:app'])
	})

	it('combines parent and explicit dependsOn', () => {
		const Project = defineComponent(makeSpec('test:project'))
		const App = defineComponent(makeSpec('test:app'))
		const graph = renderToGraph(
			jsx(Project, {
				name: 'p',
				children: jsx(App, { name: 'a', dependsOn: ['external'] }),
			})
		)
		expect(graph.resources['app:a']?.dependsOn).toEqual(['project:p', 'external'])
	})

	it('does not duplicate dependsOn entries', () => {
		const Project = defineComponent(makeSpec('test:project'))
		const App = defineComponent(makeSpec('test:app'))
		const graph = renderToGraph(
			jsx(Project, {
				name: 'p',
				children: jsx(App, { name: 'a', dependsOn: ['project:p'] }),
			})
		)
		expect(graph.resources['app:a']?.dependsOn).toEqual(['project:p'])
	})

	it('propagates phase to descendant resources', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(
			jsx(Phase, { type: 'monitoring', children: jsx(Foo, { name: 'm1' }) })
		)
		expect(graph.resources['foo:m1']?.phase).toBe('monitoring')
	})

	it('inner Phase overrides outer Phase', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(
			jsx(Phase, {
				type: 'setup',
				children: jsx(Phase, { type: 'backup', children: jsx(Foo, { name: 'b1' }) }),
			})
		)
		expect(graph.resources['foo:b1']?.phase).toBe('backup')
	})

	it('does not create a resource for Phase itself', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Phase, { type: 'setup', children: jsx(Foo, { name: 'x' }) }))
		expect(Object.keys(graph.resources)).toEqual(['foo:x'])
	})

	it('strips meta props from persisted props', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { id: 'x', dependsOn: ['y'], name: 'n', color: 'red' }))
		expect(graph.resources.x?.props).toEqual({ name: 'n', color: 'red' })
	})

	it('throws on duplicate resource ids', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		expect(() =>
			renderToGraph(
				jsx(Bar, {
					name: 'parent',
					children: [jsx(Foo, { name: 'dup' }), jsx(Foo, { name: 'dup' })],
				})
			)
		).toThrow(/Duplicate resource id/i)
	})

	it('invokes user function components and uses their output', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Wrapper = (props: { tag: string }) => jsx(Foo, { name: props.tag })
		const graph = renderToGraph(jsx(Wrapper, { tag: 'hi' }))
		expect(graph.resources['foo:hi']).toBeDefined()
	})

	it('applies defaults from the spec before persisting props', () => {
		const Foo = defineComponent(makeSpec('test:foo', { defaults: { region: 'us-east-1' } }))
		const graph = renderToGraph(jsx(Foo, { name: 'x' }))
		expect(graph.resources['foo:x']?.props).toEqual({ name: 'x', region: 'us-east-1' })
	})

	it('lets explicit props override defaults', () => {
		const Foo = defineComponent(makeSpec('test:foo', { defaults: { region: 'us-east-1' } }))
		const graph = renderToGraph(jsx(Foo, { name: 'x', region: 'eu-west-1' }))
		expect(graph.resources['foo:x']?.props).toEqual({ name: 'x', region: 'eu-west-1' })
	})

	it('runs schema.parse when provided', () => {
		const Foo = defineComponent(
			makeSpec('test:foo', {
				schema: {
					parse: (input: unknown) => {
						if (typeof (input as { name?: unknown }).name !== 'string') {
							throw new Error('name required')
						}
						return input as Record<string, unknown>
					},
				},
			})
		)
		expect(() => renderToGraph(jsx(Foo, {}))).toThrow(/name required/)
	})

	it('handles fragment-shaped root via array', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		const graph = renderToGraph([jsx(Foo, { name: 'a' }), jsx(Bar, { name: 'b' })])
		expect(Object.keys(graph.resources).sort()).toEqual(['bar:b', 'foo:a'])
	})

	it('does not create resources from primitive children', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(
			jsx(Foo, { name: 'p', children: ['some text', 42, null, undefined, false] })
		)
		expect(Object.keys(graph.resources)).toEqual(['foo:p'])
	})

	it('preserves joined text content in resource props', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const graph = renderToGraph(jsx(Foo, { name: 'p', children: ['echo hello', ' world'] }))
		expect(graph.resources['foo:p']?.props).toEqual({ name: 'p', children: 'echo hello world' })
	})

	it('drops element children from resource props', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const Bar = defineComponent(makeSpec('test:bar'))
		const graph = renderToGraph(jsx(Foo, { name: 'p', children: jsx(Bar, { name: 'b' }) }))
		expect(graph.resources['foo:p']?.props).not.toHaveProperty('children')
	})
})
