// `db-x preview <file>` — render JSX, diff against state, print the plan.

import * as p from '@clack/prompts'
import { type Plan, plan as makePlan, readState, renderToGraph } from '@db-x/runtime'
import { loadJsxFile } from '../load-jsx.js'
import { actionColor, actionLabel, actionSymbol, c, pad } from '../ui.js'

export interface PreviewArgs {
	file: string
	workDir: string
}

export async function previewCommand(args: PreviewArgs): Promise<Plan> {
	const root = await loadJsxFile(args.file)
	const graph = renderToGraph(root)
	const state = await readState(args.workDir)
	const plan = makePlan(graph, state)
	printPlan(plan)
	return plan
}

export function printPlan(plan: Plan): void {
	if (plan.actions.length === 0) {
		p.log.info(c.dim('No resources defined and no state — nothing to do.'))
		return
	}

	const counts: Record<string, number> = {}
	for (const a of plan.actions) {
		counts[a.action.type] = (counts[a.action.type] ?? 0) + 1
	}

	const meaningful = Object.entries(counts).filter(([type]) => type !== 'no-op')

	if (meaningful.length === 0) {
		p.log.info(`${c.bold('Plan')}: ${plan.actions.length} resource(s), ${c.dim('no changes.')}`)
		return
	}

	const summary = meaningful.map(([type, n]) => actionColor(type, `${n} ${type}`)).join(c.dim(', '))

	p.log.info(`${c.bold('Plan')}: ${plan.actions.length} action(s) — ${summary}`)

	const lines = plan.actions.map((a) => {
		const phase = a.desired?.phase ?? a.current?.phase ?? '-'
		const sym = actionSymbol(a.action.type)
		const label = actionLabel(a.action.type)
		const reason = 'reason' in a.action ? c.dim(` // ${a.action.reason}`) : ''
		const id = actionColor(a.action.type, pad(a.id, 28))
		const kind = c.dim(pad(a.kind, 32))
		const phaseTag = c.dim(`[${phase}]`)
		return `  ${sym} ${label}  ${id} ${kind} ${phaseTag}${reason}`
	})

	p.note(lines.join('\n'), c.bold('Resources'))
}
