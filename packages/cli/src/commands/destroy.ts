// `db-x destroy <file>` — tear down everything in state, in reverse order.
//
// The .tsx file is still loaded so its imports register component handlers
// with the runtime. The desired graph itself is discarded — we just need
// the registry populated so the state's `kind`s map to real `destroy` fns.

import * as p from '@clack/prompts'
import {
	acquireLock,
	plan as makePlan,
	readState,
	reverseForDestroy,
	writeState,
} from '@db-x/runtime'
import { type ProgressEvent, executePlan } from '../execute.js'
import { loadJsxFile } from '../load-jsx.js'
import { makeInteractiveLogger } from '../logger.js'
import { filterByPhase, validatePhase } from '../phase-filter.js'
import { failNonInteractive, isInteractive, makeSpinner as ttyMakeSpinner } from '../tty.js'
import { actionColor, c } from '../ui.js'
import { printPlan } from './preview.js'

const makeSpinner = () => ttyMakeSpinner(() => p.spinner())

export interface DestroyArgs {
	file: string
	workDir: string
	yes?: boolean
	phase?: string
}

export async function destroyCommand(args: DestroyArgs): Promise<void> {
	const targetPhase = validatePhase(args.phase)
	const isTTY = isInteractive()

	const s = makeSpinner()
	s.start('Loading deployment file')
	// Import side effects: defineComponent calls in the .tsx file register
	// handlers in the runtime registry. We do not use the returned tree.
	await loadJsxFile(args.file)

	const state = await readState(args.workDir)
	if (Object.keys(state.resources).length === 0) {
		s.stop(c.dim('No state'))
		p.outro(c.dim('Nothing to destroy.'))
		return
	}

	const emptyDesired = { resources: {}, outputs: {} }
	const fullPlan = reverseForDestroy(makePlan(emptyDesired, state))
	// When --phase is set, only tear down resources in that phase. Unphased
	// resources are left alone because something else (or a later phase) may
	// still depend on them.
	const plan = filterByPhase(fullPlan, targetPhase, { includeUnphasedWhenScoped: false })
	s.stop(c.green('Destroy plan ready'))

	printPlan(plan)

	if (!args.yes) {
		if (!isTTY) {
			failNonInteractive(
				'non-interactive stdout: pass --yes to destroy without an interactive confirmation.'
			)
		}
		const count = plan.actions.filter((a) => a.action.type !== 'no-op').length
		const ok = await p.confirm({
			message: `${c.red('Destroy')} ${c.bold(String(count))} resource(s)? This cannot be undone.`,
			initialValue: false,
		})
		if (p.isCancel(ok) || !ok) {
			p.cancel('Destroy cancelled.')
			return
		}
	}

	const lock = await acquireLock(args.workDir)
	const controller = new AbortController()
	const onSignal = (): void => controller.abort()
	process.on('SIGINT', onSignal)
	process.on('SIGTERM', onSignal)

	const exec = makeSpinner()
	exec.start('Destroying resources')

	const onProgress = (e: ProgressEvent): void => {
		const label = actionColor(e.diff.action.type, e.diff.action.type)
		if (e.type === 'start') exec.message(`${label} ${c.bold(e.diff.id)}`)
		if (e.type === 'success') p.log.success(`${label} ${c.bold(e.diff.id)}`)
		if (e.type === 'error') p.log.error(`${label} ${c.bold(e.diff.id)} — ${e.error.message}`)
	}

	try {
		const updated = await executePlan(plan, {
			workDir: args.workDir,
			state,
			abort: controller.signal,
			onProgress,
			makeLogger: makeInteractiveLogger,
		})
		await writeState(args.workDir, updated)
		exec.stop(c.green('Destroy complete'))
		p.outro(`${c.green('✔')} All resources torn down.`)
	} catch (err) {
		exec.stop(c.red('Destroy failed'), 1)
		throw err
	} finally {
		process.off('SIGINT', onSignal)
		process.off('SIGTERM', onSignal)
		await lock.release()
	}
}
