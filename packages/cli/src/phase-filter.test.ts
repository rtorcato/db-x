import {
	PHASE_ORDER,
	type Plan,
	type PlanAction,
	type Resource,
	type ResourceDiff,
	type ResourceState,
} from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import { filterByPhase, validatePhase } from './phase-filter.js'

// validatePhase and filterByPhase are the contract surface for the
// --phase=<name> flag on `apply` and `destroy`.

describe('validatePhase', () => {
	it('returns undefined for an undefined input', () => {
		expect(validatePhase(undefined)).toBeUndefined()
	})

	it('returns undefined for an empty string', () => {
		expect(validatePhase('')).toBeUndefined()
	})

	it.each(PHASE_ORDER.map((p) => [p]))('accepts %s', (phase) => {
		expect(validatePhase(phase)).toBe(phase)
	})

	it('throws on an unknown phase with the allowed set in the message', () => {
		expect(() => validatePhase('frobnicate')).toThrowError(
			/Unknown --phase value "frobnicate"\. Expected one of: setup, monitoring, backup, teardown\./
		)
	})

	it('rejects empty space-only input as unknown', () => {
		// Defensive: parseArgs trims at the arg boundary, but if a caller passes
		// a space it should still fail fast rather than silently treat as unset.
		expect(() => validatePhase(' ')).toThrowError(/Unknown --phase/)
	})
})

function resource(id: string, partial: Partial<Resource> = {}): Resource {
	return { id, kind: 'k:test', props: {}, dependsOn: [], ...partial }
}

function state(id: string, partial: Partial<ResourceState> = {}): ResourceState {
	return {
		id,
		kind: 'k:test',
		props: {},
		outputs: {},
		dependsOn: [],
		lastApplied: '2026-06-19T00:00:00.000Z',
		...partial,
	}
}

function diff(
	id: string,
	action: PlanAction,
	desired: Resource | null,
	current: ResourceState | null = null
): ResourceDiff {
	return { id, kind: 'k:test', action, desired, current }
}

function plan(...actions: ResourceDiff[]): Plan {
	return { actions }
}

describe('filterByPhase', () => {
	describe('when phase is undefined', () => {
		it('returns the same plan unchanged (run all phases)', () => {
			const input = plan(
				diff('a', { type: 'create' }, resource('a', { phase: 'setup' })),
				diff('b', { type: 'create' }, resource('b', { phase: 'backup' })),
				diff('c', { type: 'create' }, resource('c')) // unphased
			)
			const out = filterByPhase(input, undefined)
			expect(out).toBe(input)
		})
	})

	describe('when phase is set (apply defaults)', () => {
		it('keeps the targeted phase plus unphased resources', () => {
			const input = plan(
				diff('host', { type: 'create' }, resource('host')), // unphased
				diff('a', { type: 'create' }, resource('a', { phase: 'setup' })),
				diff('b', { type: 'create' }, resource('b', { phase: 'monitoring' })),
				diff('c', { type: 'no-op' }, resource('c', { phase: 'backup' }))
			)
			const out = filterByPhase(input, 'setup')
			expect(out.actions.map((a) => a.id)).toEqual(['host', 'a'])
		})

		it('reads phase from current state when desired is null (destroy plan shape)', () => {
			const input = plan(
				diff('a', { type: 'destroy', reason: 'removed' }, null, state('a', { phase: 'setup' })),
				diff('b', { type: 'destroy', reason: 'removed' }, null, state('b', { phase: 'backup' }))
			)
			const out = filterByPhase(input, 'setup')
			expect(out.actions.map((a) => a.id)).toEqual(['a'])
		})

		it('returns an empty actions list when no resources match', () => {
			const input = plan(diff('a', { type: 'create' }, resource('a', { phase: 'setup' })))
			const out = filterByPhase(input, 'teardown')
			expect(out.actions).toEqual([])
		})
	})

	describe('when phase is set with includeUnphasedWhenScoped: false (destroy)', () => {
		it('keeps only the targeted phase; unphased resources are dropped', () => {
			const input = plan(
				diff('host', { type: 'destroy', reason: 'removed' }, null, state('host')),
				diff('a', { type: 'destroy', reason: 'removed' }, null, state('a', { phase: 'setup' })),
				diff('b', { type: 'destroy', reason: 'removed' }, null, state('b', { phase: 'monitoring' }))
			)
			const out = filterByPhase(input, 'monitoring', { includeUnphasedWhenScoped: false })
			expect(out.actions.map((a) => a.id)).toEqual(['b'])
		})
	})

	it('preserves the original ordering when filtering', () => {
		const input = plan(
			diff('three', { type: 'create' }, resource('three', { phase: 'setup' })),
			diff('one', { type: 'create' }, resource('one', { phase: 'setup' })),
			diff('two', { type: 'create' }, resource('two', { phase: 'setup' }))
		)
		const out = filterByPhase(input, 'setup')
		expect(out.actions.map((a) => a.id)).toEqual(['three', 'one', 'two'])
	})
})
