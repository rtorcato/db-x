// Plan executor.
//
// Walks the ordered action list from `diff.plan()` and invokes each
// component's `apply` or `destroy` hook. Builds a fresh `Ctx` per resource,
// resolves dependency outputs from prior state, and persists state after
// every successful action so partial failures leave a consistent snapshot.

import path from 'node:path'
import {
	type Ctx,
	type Plan,
	type ResourceDiff,
	type ResourceState,
	type StateFile,
	getComponentSpec,
	writeState,
} from '@db-x/runtime'
import { makeLogger } from './logger.js'

export type ProgressEvent =
	| { type: 'start'; diff: ResourceDiff }
	| { type: 'success'; diff: ResourceDiff }
	| { type: 'error'; diff: ResourceDiff; error: Error }

export interface ExecuteOptions {
	workDir: string
	state: StateFile
	abort: AbortSignal
	dryRun?: boolean
	onProgress?: (event: ProgressEvent) => void
	makeLogger?: (scope: string) => Ctx['log']
}

export async function executePlan(plan: Plan, opts: ExecuteOptions): Promise<StateFile> {
	// Work on a copy so partial failures don't mutate the caller's state object.
	const state: StateFile = JSON.parse(JSON.stringify(opts.state))
	const logFactory = opts.makeLogger ?? makeLogger

	for (const diff of plan.actions) {
		if (diff.action.type === 'no-op') continue

		if (opts.abort.aborted) {
			throw new Error('Execution aborted.')
		}

		const spec = getComponentSpec(diff.kind)
		if (!spec) {
			throw new Error(
				`No registered handler for kind "${diff.kind}". Ensure the library is imported in your .tsx file.`
			)
		}

		const ctx: Ctx = {
			secrets: process.env,
			resource: {
				id: diff.id,
				kind: diff.kind,
				parent: diff.desired?.parent ?? diff.current?.parent,
				phase: diff.desired?.phase ?? diff.current?.phase,
				dependsOn: diff.desired?.dependsOn ?? diff.current?.dependsOn ?? [],
			},
			log: logFactory(diff.id),
			deps: buildDeps(diff, state),
			workDir: path.join(opts.workDir, '.dbx'),
			signal: opts.abort,
			dryRun: opts.dryRun ?? false,
		}

		opts.onProgress?.({ type: 'start', diff })

		try {
			await dispatch(diff, spec, ctx, state)
			opts.onProgress?.({ type: 'success', diff })
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err))
			opts.onProgress?.({ type: 'error', diff, error })
			throw new Error(`${diff.id}: ${diff.action.type} failed: ${error.message}`)
		}

		// Persist immediately. If the next action fails, the file on disk still
		// reflects everything that succeeded.
		if (!opts.dryRun) await writeState(opts.workDir, state)
	}

	return state
}

// biome-ignore lint/suspicious/noExplicitAny: erasing generic spec types at the dispatch boundary
type AnySpec = any

async function dispatch(
	diff: ResourceDiff,
	spec: AnySpec,
	ctx: Ctx,
	state: StateFile
): Promise<void> {
	switch (diff.action.type) {
		case 'create': {
			const outputs = await spec.apply(diff.desired?.props ?? {}, ctx, null)
			state.resources[diff.id] = recordOf(diff, outputs)
			return
		}
		case 'update': {
			const outputs = await spec.apply(diff.desired?.props ?? {}, ctx, diff.current ?? null)
			state.resources[diff.id] = recordOf(diff, outputs)
			return
		}
		case 'replace': {
			if (diff.current) {
				await spec.destroy(diff.current, ctx)
				delete state.resources[diff.id]
			}
			const outputs = await spec.apply(diff.desired?.props ?? {}, ctx, null)
			state.resources[diff.id] = recordOf(diff, outputs)
			return
		}
		case 'destroy': {
			if (diff.current) {
				await spec.destroy(diff.current, ctx)
				delete state.resources[diff.id]
			}
			return
		}
		case 'no-op':
			return
	}
}

function recordOf(diff: ResourceDiff, outputs: unknown): ResourceState {
	if (!diff.desired) {
		throw new Error(`Internal: missing desired resource for ${diff.id}`)
	}
	return {
		id: diff.id,
		kind: diff.kind,
		props: diff.desired.props,
		outputs: (outputs as object) ?? {},
		dependsOn: diff.desired.dependsOn,
		parent: diff.desired.parent,
		phase: diff.desired.phase,
		lastApplied: new Date().toISOString(),
	}
}

function buildDeps(diff: ResourceDiff, state: StateFile): Record<string, object> {
	const deps: Record<string, object> = {}
	const depIds = diff.desired?.dependsOn ?? diff.current?.dependsOn ?? []
	for (const id of depIds) {
		const dep = state.resources[id]
		if (dep) deps[id] = dep.outputs
	}
	return deps
}
