import { describe, expect, it } from 'vitest'
import { defineComponent } from './define-component.js'
import { ELEMENT_TYPE, jsx } from './jsx-runtime.js'
import { PHASE_ORDER, Phase, isPhaseComponent } from './phase.js'

describe('Phase', () => {
	it('is detected by isPhaseComponent', () => {
		expect(isPhaseComponent(Phase)).toBe(true)
	})

	it('is not detected as a regular component', () => {
		expect(isPhaseComponent(() => undefined)).toBe(false)
		expect(isPhaseComponent({})).toBe(false)
		expect(isPhaseComponent(null)).toBe(false)
	})

	it('distinct from defineComponent-built components', () => {
		const Foo = defineComponent({
			kind: 'test:foo',
			apply: () => Promise.resolve({}),
			destroy: () => Promise.resolve(),
		})
		expect(isPhaseComponent(Foo)).toBe(false)
	})

	it('cannot be called directly', () => {
		expect(() => (Phase as unknown as () => void)()).toThrow(/JSX-only/i)
	})

	it('can be used as a JSX element', () => {
		const el = jsx(Phase, { type: 'setup', children: [] })
		expect(el.$$typeof).toBe(ELEMENT_TYPE)
		expect(el.type).toBe(Phase)
		expect(el.props.type).toBe('setup')
	})

	it('PHASE_ORDER lists all four phases in apply order', () => {
		expect(PHASE_ORDER).toEqual(['setup', 'monitoring', 'backup', 'teardown'])
	})
})
