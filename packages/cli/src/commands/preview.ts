// `db-x preview <file>` — render JSX, diff against state, print the plan.

import * as p from '@clack/prompts'
import {
	type Plan,
	type PlanAction,
	plan as makePlan,
	readState,
	renderToGraph,
} from '@db-x/runtime'
import { loadJsxFile } from '../load-jsx.js'
import { actionColor, actionLabel, actionSymbol, c, pad } from '../ui.js'

/** Destructive changes an action entails, if any. */
function actionDestructive(action: PlanAction): string[] {
	return 'destructive' in action ? (action.destructive ?? []) : []
}

/** The exact statements an action will run, if the component computed them. */
function actionDetails(action: PlanAction): string[] {
	return 'details' in action ? (action.details ?? []) : []
}

// A wide migration can plan dozens of statements; past this the plan stops
// being readable, which is the whole point of showing them.
// ponytail: fixed cap, and the elision is reported rather than silent.
const MAX_DETAIL_LINES = 10

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

	const lines = plan.actions.flatMap((a) => {
		const destructive = actionDestructive(a.action)
		// `!` in red flags a destructive action; otherwise the action's own symbol.
		const sym = destructive.length > 0 ? c.red('!') : actionSymbol(a.action.type)
		const label = actionLabel(a.action.type)
		const id = actionColor(a.action.type, pad(a.id, 26))
		const kind = c.dim(a.kind)
		// Only show the phase when one is actually in use — `[-]` on every row is
		// noise for the common single-phase deployment.
		const phase = a.desired?.phase ?? a.current?.phase
		const phaseTag = phase ? c.dim(` [${phase}]`) : ''
		const head = `  ${sym} ${label}  ${id} ${kind}${phaseTag}`

		// The statements themselves are what makes a plan reviewable. Fall back
		// to the summary `reason` for components that don't compute them.
		const details = actionDetails(a.action)
		if (details.length === 0) {
			const reason = 'reason' in a.action ? `\n      ${c.dim(a.action.reason)}` : ''
			return [`${head}${reason}`]
		}

		// The statement itself is printed undimmed — it is the thing being
		// reviewed, so it must be the brightest text on the row. Only the
		// leading marker is dimmed, as chrome.
		const shown = details.slice(0, MAX_DETAIL_LINES).map((stmt) => {
			const isDestructive = destructive.includes(stmt)
			return isDestructive ? `      ${c.red('!')} ${c.red(stmt)}` : `      ${c.dim('→')} ${stmt}`
		})
		const hidden = details.length - shown.length
		if (hidden > 0) {
			shown.push(`      ${c.dim(`… ${hidden} more statement(s) — run apply to execute all`)}`)
		}
		return [head, ...shown]
	})

	p.note(lines.join('\n'), c.bold('Resources'))

	const destructive = plan.actions.flatMap((a) =>
		actionDestructive(a.action).map((ch) => `  ${a.id}: ${ch}`)
	)
	if (destructive.length > 0) {
		p.note(destructive.join('\n'), c.red('! destructive'))
		p.log.warn(
			`${c.red('Destructive changes')} — ${c.bold('apply')} needs ${c.yellow('--allow-destructive')}, and none may be under a ${c.bold('protect')}-ed <Postgres>.`
		)
	}
}
