// `db-x restore [--snapshot <id>]` — roll the database back to a captured snapshot.
//
// Uses the pre-flight snapshots `apply` takes before destructive changes (#7),
// through whichever driver captured them (#78). No JSX file is needed: the
// database connection and the snapshot pin both live in `.dbx/` (state + the
// snapshot store), so restore works purely from what's on disk. Restoring
// overwrites the live schema, so it's gated like `destroy` — confirm +
// `--yes`, under the state lock.

import * as p from '@clack/prompts'
import { acquireLock, readState } from '@db-x/runtime'
import { createSnapshotDriver, resolveSnapshotTarget, selectSnapshotId } from '../snapshot.js'
import { failNonInteractive, isInteractive, makeSpinner as ttyMakeSpinner } from '../tty.js'
import { c } from '../ui.js'

const makeSpinner = () => ttyMakeSpinner(() => p.spinner())

export interface RestoreArgs {
	workDir: string
	yes?: boolean
	/** Explicit snapshot id. Defaults to the one pinned to state, else the newest. */
	snapshot?: string
}

export async function restoreCommand(args: RestoreArgs): Promise<void> {
	const isTTY = isInteractive()

	const state = await readState(args.workDir)
	if (Object.keys(state.resources).length === 0) {
		p.outro(c.dim('No state — nothing to restore into.'))
		return
	}

	const target = resolveSnapshotTarget(state)
	if (!target) {
		throw new Error(
			'No snapshot-capable database connection found in state — restore needs a database component (e.g. <Postgres> or <Mongo>) in .dbx/state.json.'
		)
	}

	const driver = createSnapshotDriver(target, args.workDir)

	const available = await driver.list() // newest first
	if (available.length === 0) {
		throw new Error(
			'No snapshots in .dbx/snapshots — apply captures one before destructive DDL; nothing to restore.'
		)
	}

	const targetId = selectSnapshotId(args.snapshot, state.snapshot, available)
	const ref = available.find((r) => r.id === targetId)
	if (!ref) {
		throw new Error(
			`Snapshot "${targetId}" not found in the store. Available (newest first): ${available
				.map((r) => r.id)
				.join(', ')}`
		)
	}

	p.note(
		[
			`snapshot    ${c.bold(ref.id)}`,
			`state rev   ${ref.stateRev}`,
			`captured    ${ref.createdAt}`,
			`mode        ${ref.mode} (${ref.driver})`,
			`into        ${target.label}`,
		].join('\n'),
		c.yellow('restore')
	)

	if (!args.yes) {
		if (!isTTY) {
			failNonInteractive(
				'non-interactive stdout: pass --yes to restore without an interactive confirmation.'
			)
		}
		const ok = await p.confirm({
			message: `${c.red('Restore')} overwrites the live schema in ${c.bold(target.label)} from ${c.bold(ref.id)}. Continue?`,
			initialValue: false,
		})
		if (p.isCancel(ok) || !ok) {
			p.cancel('Restore cancelled.')
			return
		}
	}

	const lock = await acquireLock(args.workDir)
	const spin = makeSpinner()
	spin.start(`Restoring ${ref.id}`)
	try {
		await driver.restore(ref)
		spin.stop(c.green(`Restored ${c.bold(ref.id)}`))
	} catch (err) {
		spin.stop(c.red('Restore failed'))
		throw err
	} finally {
		await lock.release()
	}

	// The DB now matches `ref.stateRev`, but .dbx/state.json still describes the
	// revision applied *after* the snapshot was taken. We keep only DB snapshots,
	// not historical state copies, so state can't be rolled back automatically.
	// ponytail: DB-only rollback; full state-rev rollback needs state snapshots too (#6).
	p.log.warn(
		'state.json still describes the post-snapshot revision — the live DB is now behind it. Run `db-x preview` / `db-x refresh` to reconcile the drift.'
	)
	p.outro(`${c.green('✔')} Database restored from ${ref.id}.`)
}
