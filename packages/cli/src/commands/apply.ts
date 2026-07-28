// `db-x apply <file>` — render JSX, diff, execute, persist.

import process from 'node:process'
import * as p from '@clack/prompts'
import {
	acquireLock,
	findDestructiveViolations,
	plan as makePlan,
	readState,
	renderToGraph,
	type SnapshotRef,
	writeState,
} from '@db-x/runtime'
import { type ProgressEvent, executePlan } from '../execute.js'
import { loadJsxFile } from '../load-jsx.js'
import { makeInteractiveLogger, makeLogger } from '../logger.js'
import { filterByPhase, validatePhase } from '../phase-filter.js'
import { createSnapshotDriver, planHasDestructive, resolveSnapshotTarget } from '../snapshot.js'
import { failNonInteractive, isInteractive, makeSpinner as ttyMakeSpinner } from '../tty.js'
import { actionColor, block, c } from '../ui.js'
import { printPlan } from './preview.js'

export interface ApplyArgs {
	file: string
	workDir: string
	yes?: boolean
	phase?: string
	/** Permit destructive DDL on unprotected resources. Never overrides `protect`. */
	allowDestructive?: boolean
	/** Skip the pre-flight snapshot that `apply` takes before destructive DDL. */
	noSnapshot?: boolean
}

const makeSpinner = () => ttyMakeSpinner(() => p.spinner())

export async function applyCommand(args: ApplyArgs): Promise<void> {
	const isTTY = isInteractive()
	const targetPhase = validatePhase(args.phase)

	const s = makeSpinner()
	s.start('Loading deployment file')
	const root = await loadJsxFile(args.file)
	const graph = renderToGraph(root)
	const state = await readState(args.workDir)
	const fullPlan = makePlan(graph, state)

	// When --phase is set, filter to that phase plus the unphased resources
	// (e.g. <Host> declared outside any <Phase>) that everything depends on.
	// Without --phase, run all phases in PHASE_ORDER.
	const plan = filterByPhase(fullPlan, targetPhase)

	s.stop(c.green('Plan ready'))

	printPlan(plan)

	const meaningful = plan.actions.filter((a) => a.action.type !== 'no-op')
	if (meaningful.length === 0) {
		p.outro(c.dim('Nothing to do.'))
		return
	}

	// Destructive guard — refuse before touching the database or the lock.
	const violations = findDestructiveViolations(plan, graph, state, {
		allowDestructive: args.allowDestructive ?? false,
	})
	if (violations.length > 0) {
		const lines = violations.flatMap((v) => v.changes.map((ch) => `  ${v.id}: ${c.red(ch)}`))
		block(c.red('! destructive'), lines.join('\n'))
		const protectedCount = violations.filter((v) => v.reason === 'protected').length
		const hints: string[] = []
		if (protectedCount > 0) {
			hints.push(
				`${protectedCount} under a protect-ed <Postgres> — remove \`protect\` in the JSX to allow`
			)
		}
		if (violations.some((v) => v.reason === 'needs-allow-destructive')) {
			hints.push('re-run with --allow-destructive to permit the rest')
		}
		throw new Error(`Refusing ${violations.length} destructive change(s): ${hints.join('; ')}.`)
	}

	if (!args.yes) {
		if (!isTTY) {
			failNonInteractive(
				'non-interactive stdout: pass --yes to apply without an interactive confirmation.'
			)
		}
		const ok = await p.confirm({
			message: `Apply ${c.bold(String(meaningful.length))} change(s)?`,
			initialValue: false,
		})
		if (p.isCancel(ok) || !ok) {
			p.cancel('Apply cancelled.')
			return
		}
	}

	const lock = await acquireLock(args.workDir)
	const controller = new AbortController()
	const onSignal = (): void => controller.abort()
	process.on('SIGINT', onSignal)
	process.on('SIGTERM', onSignal)

	const exec = makeSpinner()
	let applying = false

	const onProgress = (e: ProgressEvent): void => {
		const label = actionColor(e.diff.action.type, e.diff.action.type)
		if (e.type === 'start') exec.message(`${label} ${c.bold(e.diff.id)}`)
		if (e.type === 'success') p.log.success(`${label} ${c.bold(e.diff.id)}`)
		if (e.type === 'error') p.log.error(`${label} ${c.bold(e.diff.id)} — ${e.error.message}`)
	}

	try {
		// Snapshot before any destructive DDL so a bad apply is recoverable (#7).
		// Pinned afterward to the resulting state revision.
		let snapshotRef: SnapshotRef | null = null
		if (!args.noSnapshot && planHasDestructive(plan)) {
			const target = resolveSnapshotTarget(state)
			if (!target) {
				throw new Error(
					'Refusing destructive changes without a snapshot: no database connection found in state to snapshot. Re-run with --no-snapshot to proceed without one.'
				)
			}
			const snap = makeSpinner()
			snap.start(`Snapshotting ${target.label} before destructive changes (${target.driver})`)
			try {
				const driver = createSnapshotDriver(target, args.workDir)
				snapshotRef = await driver.create(state.lastApplied ?? 'initial')
				snap.stop(c.green(`Snapshot ${c.bold(snapshotRef.id)} captured`))
			} catch (err) {
				snap.stop(c.red('Snapshot failed'))
				throw err
			}
		}

		applying = true
		exec.start('Applying changes')
		const updated = await executePlan(plan, {
			workDir: args.workDir,
			state,
			abort: controller.signal,
			onProgress,
			makeLogger: isTTY ? makeInteractiveLogger : makeLogger,
		})
		if (snapshotRef) updated.snapshot = snapshotRef.id
		await writeState(args.workDir, updated)
		exec.stop(c.green('Apply complete'))
		p.outro(`${c.green('✔')} ${meaningful.length} change(s) applied.`)

		const urls = Object.values(updated.resources)
			.map((r) => (r.outputs as Record<string, unknown>).url)
			.filter((u): u is string => typeof u === 'string')
		if (urls.length > 0) {
			p.note(urls.join('\n'), 'Access')
		}
	} catch (err) {
		if (applying) exec.stop(c.red('Apply failed'))
		throw err
	} finally {
		process.off('SIGINT', onSignal)
		process.off('SIGTERM', onSignal)
		await lock.release()
	}
}
