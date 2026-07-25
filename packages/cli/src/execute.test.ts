import {
	type Plan,
	type ResourceDiff,
	STATE_SCHEMA_VERSION,
	type StateFile,
	defineComponent,
} from '@db-x/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock writeState so executePlan does not touch the filesystem. The spy is
// hoisted alongside vi.mock so it's safely visible inside the factory.
const { writeStateMock } = vi.hoisted(() => ({
	writeStateMock: vi.fn(async (_workDir: string, _state: StateFile) => {}),
}))
vi.mock('@db-x/runtime', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@db-x/runtime')>()
	return { ...actual, writeState: writeStateMock }
})

// Imported after the mock so executePlan binds to the mocked writeState.
const { executePlan } = await import('./execute.js')

// The runtime registry is global. Tests below use unique `kind`s per test
// so registrations never collide; no clearRegistry is needed here.

function emptyState(): StateFile {
	return { version: STATE_SCHEMA_VERSION, resources: {} }
}

function noOpDiff(id: string, kind: string): ResourceDiff {
	return {
		id,
		kind,
		action: { type: 'no-op' },
		desired: { id, kind, props: {}, dependsOn: [] },
		current: {
			id,
			kind,
			props: {},
			outputs: {},
			dependsOn: [],
			lastApplied: '2026-06-19T00:00:00.000Z',
		},
	}
}

function createDiff(id: string, kind: string, props: Record<string, unknown> = {}): ResourceDiff {
	return {
		id,
		kind,
		action: { type: 'create' },
		desired: { id, kind, props, dependsOn: [] },
		current: null,
	}
}

function plan(...actions: ResourceDiff[]): Plan {
	return { actions }
}

const abortNever = new AbortController().signal

describe('executePlan', () => {
	beforeEach(() => {
		writeStateMock.mockClear()
	})

	it('no-op only plan: invokes no apply, no destroy, and produces an unchanged state copy', async () => {
		const applySpy = vi.fn()
		const destroySpy = vi.fn()
		defineComponent<Record<string, unknown>, Record<string, unknown>>({
			kind: 'test:noop',
			apply: applySpy,
			destroy: destroySpy,
		})

		const before = emptyState()
		const after = await executePlan(plan(noOpDiff('a', 'test:noop'), noOpDiff('b', 'test:noop')), {
			workDir: '/tmp/dbx-test',
			state: before,
			abort: abortNever,
		})

		expect(applySpy).not.toHaveBeenCalled()
		expect(destroySpy).not.toHaveBeenCalled()
		// executePlan walks no-op diffs without ever writing state.
		expect(writeStateMock).not.toHaveBeenCalled()
		// The returned state is a copy of the input, not the same reference.
		expect(after).not.toBe(before)
		expect(after).toStrictEqual(before)
	})

	it('create action: calls apply, records outputs in state, persists once per action', async () => {
		defineComponent<{ name: string }, { url: string }>({
			kind: 'test:create',
			apply: async (props) => ({ url: `https://example.com/${props.name}` }),
			destroy: async () => {},
		})

		const after = await executePlan(plan(createDiff('thing', 'test:create', { name: 'thing' })), {
			workDir: '/tmp/dbx-test',
			state: emptyState(),
			abort: abortNever,
		})

		expect(after.resources.thing).toBeDefined()
		expect(after.resources.thing?.outputs).toEqual({ url: 'https://example.com/thing' })
		expect(writeStateMock).toHaveBeenCalledTimes(1)
	})

	it('dryRun: does not persist state to disk even on a create', async () => {
		defineComponent<Record<string, unknown>, { ok: boolean }>({
			kind: 'test:dryrun',
			apply: async () => ({ ok: true }),
			destroy: async () => {},
		})

		await executePlan(plan(createDiff('x', 'test:dryrun')), {
			workDir: '/tmp/dbx-test',
			state: emptyState(),
			abort: abortNever,
			dryRun: true,
		})

		expect(writeStateMock).not.toHaveBeenCalled()
	})

	it('unknown kind: throws a helpful error', async () => {
		await expect(
			executePlan(plan(createDiff('y', 'never-registered:thing')), {
				workDir: '/tmp/dbx-test',
				state: emptyState(),
				abort: abortNever,
			})
		).rejects.toThrow(/No registered handler for kind "never-registered:thing"/)
	})

	it('aborted signal: throws before invoking apply', async () => {
		const applySpy = vi.fn()
		defineComponent<Record<string, unknown>, Record<string, unknown>>({
			kind: 'test:abort',
			apply: applySpy,
			destroy: async () => {},
		})

		const ctrl = new AbortController()
		ctrl.abort()

		await expect(
			executePlan(plan(createDiff('z', 'test:abort')), {
				workDir: '/tmp/dbx-test',
				state: emptyState(),
				abort: ctrl.signal,
			})
		).rejects.toThrow(/Execution aborted/)
		expect(applySpy).not.toHaveBeenCalled()
	})

	it('emits progress events in start → success order on the happy path', async () => {
		defineComponent<Record<string, unknown>, Record<string, unknown>>({
			kind: 'test:progress',
			apply: async () => ({}),
			destroy: async () => {},
		})

		const events: string[] = []
		await executePlan(plan(createDiff('p', 'test:progress')), {
			workDir: '/tmp/dbx-test',
			state: emptyState(),
			abort: abortNever,
			onProgress: (e) => events.push(e.type),
		})

		expect(events).toEqual(['start', 'success'])
	})
})
