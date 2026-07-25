import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, isDbXComponent } from './define-component.js'
import { ELEMENT_TYPE, jsx } from './jsx-runtime.js'
import { clearRegistry, getComponentSpec, listComponents } from './registry.js'
import type { ComponentSpec } from './types.js'

function noop(): Promise<Record<string, unknown>> {
	return Promise.resolve({})
}

function makeSpec(kind: string): ComponentSpec<Record<string, unknown>, Record<string, unknown>> {
	return {
		kind,
		apply: noop,
		destroy: () => Promise.resolve(),
	}
}

describe('defineComponent', () => {
	beforeEach(() => {
		clearRegistry()
	})

	it('registers the component kind in the global registry', () => {
		const spec = makeSpec('test:thing')
		defineComponent(spec)
		expect(getComponentSpec('test:thing')).toBe(spec)
		expect(listComponents()).toEqual(['test:thing'])
	})

	it('returns a function carrying the __dbx brand', () => {
		const Component = defineComponent(makeSpec('test:branded'))
		expect(Component.__dbx.kind).toBe('test:branded')
		expect(isDbXComponent(Component)).toBe(true)
	})

	it('the returned function throws if called directly (not via JSX)', () => {
		const Component = defineComponent(makeSpec('test:not-callable'))
		expect(() => (Component as unknown as () => void)()).toThrow(/not callable directly/i)
	})

	it('produces an ElementNode when used as JSX', () => {
		const Foo = defineComponent(makeSpec('test:foo'))
		const element = jsx(Foo, { name: 'hello' })
		expect(element.$$typeof).toBe(ELEMENT_TYPE)
		expect(element.type).toBe(Foo)
		expect((element.props as { name: string }).name).toBe('hello')
		expect(element.props.children).toEqual([])
	})

	it('normalizes a single child into an array', () => {
		const Parent = defineComponent(makeSpec('test:parent'))
		const Child = defineComponent(makeSpec('test:child'))
		const element = jsx(Parent, { children: jsx(Child, {}) })
		expect(Array.isArray(element.props.children)).toBe(true)
		expect(element.props.children).toHaveLength(1)
	})

	it('keeps multiple children as an array', () => {
		const Parent = defineComponent(makeSpec('test:multi-parent'))
		const ChildA = defineComponent(makeSpec('test:multi-a'))
		const ChildB = defineComponent(makeSpec('test:multi-b'))
		const element = jsx(Parent, {
			children: [jsx(ChildA, {}), jsx(ChildB, {})],
		})
		expect(element.props.children).toHaveLength(2)
	})

	it('throws when the same kind is registered twice with different specs', () => {
		defineComponent(makeSpec('test:dup'))
		expect(() => defineComponent(makeSpec('test:dup'))).toThrow(/Duplicate component kind/)
	})

	it('allows re-registering the same spec object (e.g. on hot reload)', () => {
		const spec = makeSpec('test:hot')
		defineComponent(spec)
		expect(() => registerSameSpec(spec)).not.toThrow()
	})

	it('isDbXComponent returns false for plain functions and non-functions', () => {
		expect(isDbXComponent(() => undefined)).toBe(false)
		expect(isDbXComponent({})).toBe(false)
		expect(isDbXComponent(null)).toBe(false)
		expect(isDbXComponent('test:string')).toBe(false)
	})
})

// Helper that goes through defineComponent (which re-calls registerComponent
// with the same spec object) to demonstrate identity-based dedup.
function registerSameSpec(
	spec: ComponentSpec<Record<string, unknown>, Record<string, unknown>>
): void {
	defineComponent(spec)
}
