// `db-x describe <file>` — emit a single LLM-optimized JSON blob covering
// the desired graph, the current state, the plan, and a flat per-resource
// view that resolves both incoming and outgoing dependency edges.
//
// Design goals:
//   - Stdout is *only* JSON. Pipe to `jq` without surgery.
//   - All status / progress messages go to stderr (via console.error).
//   - One read gives an AI agent (or human) the whole picture: what's
//     declared, what's deployed, what would change, and how resources
//     relate.
//
// Output schema: see docs/describe-schema.md (when written). The top-level
// `schema` field versions the format so future consumers can detect breaks.
//
// Part of the AI-readability moat (TODO.md Phase 2.1).

import process from 'node:process'
import {
	type Plan,
	type Resource,
	type ResourceState,
	plan as makePlan,
	readState,
	renderToGraph,
} from '@db-x/runtime'
import type { StateFile } from '@db-x/runtime'
import { loadJsxFile } from '../load-jsx.js'

export const SCHEMA_VERSION = 'db-x.describe/v1'

export interface DescribeArgs {
	file: string
	workDir: string
}

interface DescribeResource {
	id: string
	kind: string
	phase: string | null
	parent: string | null
	dependsOn: string[]
	dependents: string[]
	props: Record<string, unknown> | null
	stateProps: Record<string, unknown> | null
	outputs: Record<string, unknown> | null
	lastApplied: string | null
	action: Plan['actions'][number]['action']
	description: string | null
	inJsx: boolean
	inState: boolean
}

export interface DescribeOutput {
	schema: string
	generatedAt: string
	project: {
		file: string
		workDir: string
	}
	summary: {
		totalResources: number
		byKind: Record<string, number>
		byPhase: Record<string, number>
		byAction: Record<string, number>
	}
	resources: DescribeResource[]
}

export async function describeCommand(args: DescribeArgs): Promise<DescribeOutput> {
	console.error('db-x describe: loading deployment file')
	const root = await loadJsxFile(args.file)
	const graph = renderToGraph(root)
	const state = await readState(args.workDir)
	const plan = makePlan(graph, state)

	const output = buildDescribe(args, graph.resources, state, plan)
	process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
	return output
}

export function buildDescribe(
	args: DescribeArgs,
	desired: Record<string, Resource>,
	state: StateFile,
	plan: Plan
): DescribeOutput {
	const dependents = computeDependents(desired)

	// Index plan actions by resource id for O(1) lookup.
	const actionsById = new Map<string, Plan['actions'][number]>()
	for (const a of plan.actions) {
		actionsById.set(a.id, a)
	}

	// Union of all ids — anything declared in JSX OR persisted in state.
	const allIds = new Set<string>([...Object.keys(desired), ...Object.keys(state.resources)])

	const resources: DescribeResource[] = []
	for (const id of allIds) {
		const declared = desired[id] ?? null
		const persisted = state.resources[id] ?? null
		const planEntry = actionsById.get(id)

		resources.push({
			id,
			kind: declared?.kind ?? persisted?.kind ?? 'unknown',
			phase: declared?.phase ?? persisted?.phase ?? null,
			parent: declared?.parent ?? persisted?.parent ?? null,
			dependsOn: declared?.dependsOn ?? persisted?.dependsOn ?? [],
			dependents: dependents.get(id) ?? [],
			props: declared?.props ?? null,
			stateProps: (persisted?.props as Record<string, unknown> | undefined) ?? null,
			outputs: (persisted?.outputs as Record<string, unknown> | undefined) ?? null,
			lastApplied: persisted?.lastApplied ?? null,
			action: planEntry?.action ?? { type: 'no-op' },
			description: extractDescription(declared?.props ?? persisted?.props ?? undefined),
			inJsx: declared !== null,
			inState: persisted !== null,
		})
	}

	// Stable ordering: by phase rank, then by id.
	resources.sort((a, b) => {
		const pa = phaseRank(a.phase)
		const pb = phaseRank(b.phase)
		if (pa !== pb) return pa - pb
		return a.id.localeCompare(b.id)
	})

	return {
		schema: SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		project: {
			file: args.file,
			workDir: args.workDir,
		},
		summary: buildSummary(resources),
		resources,
	}
}

function buildSummary(resources: DescribeResource[]): DescribeOutput['summary'] {
	const byKind: Record<string, number> = {}
	const byPhase: Record<string, number> = {}
	const byAction: Record<string, number> = {}
	for (const r of resources) {
		byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
		const phaseKey = r.phase ?? 'unphased'
		byPhase[phaseKey] = (byPhase[phaseKey] ?? 0) + 1
		byAction[r.action.type] = (byAction[r.action.type] ?? 0) + 1
	}
	return {
		totalResources: resources.length,
		byKind,
		byPhase,
		byAction,
	}
}

function computeDependents(desired: Record<string, Resource>): Map<string, string[]> {
	const out = new Map<string, string[]>()
	for (const r of Object.values(desired)) {
		for (const depId of r.dependsOn) {
			const list = out.get(depId)
			if (list) {
				list.push(r.id)
			} else {
				out.set(depId, [r.id])
			}
		}
	}
	// Sort for determinism so the output is stable across runs.
	for (const list of out.values()) {
		list.sort()
	}
	return out
}

function extractDescription(
	props: Record<string, unknown> | ResourceState['props'] | undefined
): string | null {
	if (!props || typeof props !== 'object') return null
	const desc = (props as Record<string, unknown>).description
	return typeof desc === 'string' ? desc : null
}

const PHASE_RANK: Record<string, number> = {
	unphased: 0,
	setup: 1,
	monitoring: 2,
	backup: 3,
	teardown: 4,
}

function phaseRank(phase: string | null): number {
	return PHASE_RANK[phase ?? 'unphased'] ?? 99
}
