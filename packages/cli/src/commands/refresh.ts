// `db-x refresh <file>` — re-read live infrastructure and expose drift.
//
// For each resource in `.dbx/state.json`, call the component's optional
// `refresh(state, ctx)` hook (a pure read), compare the returned outputs to
// what state records, and update state where they diverge. The JSX file is
// loaded only for its side effect: importing it registers the component
// kinds so `getComponentSpec` can resolve them.

import path from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import {
	type Ctx,
	type ResourceState,
	type StateFile,
	acquireLock,
	getComponentSpec,
	readState,
	writeState,
} from '@db-x/runtime'
import { loadJsxFile } from '../load-jsx.js'
import { makeLogger } from '../logger.js'
import { block, c, pad, symbols } from '../ui.js'

export interface RefreshArgs {
	file: string
	workDir: string
}

type DriftStatus = 'drift' | 'in-sync' | 'skipped' | 'error'

interface DriftEntry {
	id: string
	kind: string
	status: DriftStatus
	before?: Record<string, unknown>
	after?: Record<string, unknown>
	error?: string
}

export interface RefreshResult {
	entries: DriftEntry[]
	/** State with drifted resources' outputs updated to match live infra. */
	state: StateFile
}

/** A component as far as refresh cares — only the optional read hook. */
interface RefreshableSpec {
	refresh?: (state: ResourceState, ctx: Ctx) => Promise<object>
}

export interface RefreshDeps {
	getSpec: (kind: string) => RefreshableSpec | undefined
	makeCtx: (state: ResourceState) => Ctx
}

/**
 * Pure core: run every resource's `refresh` hook and report drift. Takes its
 * spec lookup and Ctx factory as dependencies so it's testable without the
 * global registry, the JSX loader, or real infrastructure.
 */
export async function refreshState(input: StateFile, deps: RefreshDeps): Promise<RefreshResult> {
	// Work on a copy so a caller's state object is never mutated in place.
	const next: StateFile = JSON.parse(JSON.stringify(input))
	const entries: DriftEntry[] = []

	for (const id of Object.keys(input.resources)) {
		const resource = input.resources[id]
		if (!resource) continue

		const spec = deps.getSpec(resource.kind)
		if (!spec?.refresh) {
			entries.push({ id, kind: resource.kind, status: 'skipped' })
			continue
		}

		try {
			const after = ((await spec.refresh(resource, deps.makeCtx(resource))) ?? {}) as Record<
				string,
				unknown
			>
			const before = (resource.outputs ?? {}) as Record<string, unknown>
			const drifted = JSON.stringify(before) !== JSON.stringify(after)
			if (drifted) {
				const rec = next.resources[id]
				if (rec) rec.outputs = after
			}
			entries.push({
				id,
				kind: resource.kind,
				status: drifted ? 'drift' : 'in-sync',
				before,
				after,
			})
		} catch (err) {
			entries.push({
				id,
				kind: resource.kind,
				status: 'error',
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	return { entries, state: next }
}

export async function refreshCommand(args: RefreshArgs): Promise<RefreshResult> {
	// Importing the deployment file registers its component kinds. Nothing in
	// the rendered graph is used — refresh operates purely on persisted state.
	await loadJsxFile(args.file)
	const state = await readState(args.workDir)

	const ids = Object.keys(state.resources)
	if (ids.length === 0) {
		p.log.info(c.dim('(empty state) — nothing to refresh.'))
		return { entries: [], state }
	}

	const dbxDir = path.join(args.workDir, '.dbx')
	const controller = new AbortController()
	const onSignal = (): void => controller.abort()
	process.on('SIGINT', onSignal)
	process.on('SIGTERM', onSignal)

	const makeCtx = (resource: ResourceState): Ctx => ({
		secrets: process.env,
		resource: {
			id: resource.id,
			kind: resource.kind,
			parent: resource.parent,
			phase: resource.phase,
			dependsOn: resource.dependsOn,
		},
		log: makeLogger(resource.id),
		deps: buildDeps(resource, state),
		workDir: dbxDir,
		signal: controller.signal,
		dryRun: true, // refresh is read-only; components must not mutate.
	})

	const lock = await acquireLock(args.workDir)
	try {
		const result = await refreshState(state, {
			getSpec: getComponentSpec as RefreshDeps['getSpec'],
			makeCtx,
		})
		if (result.entries.some((e) => e.status === 'drift')) {
			await writeState(args.workDir, result.state)
		}
		printDrift(result.entries)
		return result
	} finally {
		process.off('SIGINT', onSignal)
		process.off('SIGTERM', onSignal)
		await lock.release()
	}
}

/** Resolve dependency outputs from state, mirroring the executor's Ctx. */
function buildDeps(resource: ResourceState, state: StateFile): Record<string, object> {
	const deps: Record<string, object> = {}
	for (const depId of resource.dependsOn) {
		const dep = state.resources[depId]
		if (dep) deps[depId] = dep.outputs
	}
	return deps
}

/** Output keys whose value changed between the stored and refreshed outputs. */
function driftKeys(entry: DriftEntry): string[] {
	const before = entry.before ?? {}
	const after = entry.after ?? {}
	const keys = new Set([...Object.keys(before), ...Object.keys(after)])
	return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
}

function printDrift(entries: DriftEntry[]): void {
	const drift = entries.filter((e) => e.status === 'drift')
	const errors = entries.filter((e) => e.status === 'error')
	const skipped = entries.filter((e) => e.status === 'skipped')
	const refreshed = entries.filter((e) => e.status === 'drift' || e.status === 'in-sync').length

	const parts = [`${refreshed} refreshed`]
	if (drift.length) parts.push(c.yellow(`${drift.length} drifted`))
	if (errors.length) parts.push(c.red(`${errors.length} error(s)`))
	if (skipped.length) parts.push(c.dim(`${skipped.length} skipped`))
	p.log.info(`${c.bold('Refresh')}: ${parts.join(c.dim(', '))}`)

	const lines = entries.map((e) => {
		const sym =
			e.status === 'drift'
				? symbols.update
				: e.status === 'error'
					? symbols.destroy
					: e.status === 'skipped'
						? symbols.unknown
						: symbols.noop
		const id = pad(e.id, 28)
		const kind = c.dim(pad(e.kind, 32))
		const detail =
			e.status === 'drift'
				? c.yellow(` drift: ${driftKeys(e).join(', ')}`)
				: e.status === 'error'
					? c.red(` ${e.error}`)
					: e.status === 'skipped'
						? c.dim(' no refresh() hook')
						: c.dim(' in sync')
		return `  ${sym} ${id} ${kind}${detail}`
	})
	block('Resources', lines.join('\n'))

	if (drift.length > 0) {
		p.log.warn(
			`${drift.length} resource(s) drifted — state outputs updated to match live infrastructure.`
		)
	}
}
