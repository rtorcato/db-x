// `db-x state` — print the contents of `.dbx/state.json`.

import * as p from '@clack/prompts'
import { readState } from '@db-x/runtime'
import { block, c, pad } from '../ui.js'

export interface StateArgs {
	workDir: string
}

export async function stateCommand(args: StateArgs): Promise<void> {
	const state = await readState(args.workDir)
	const ids = Object.keys(state.resources)

	if (ids.length === 0) {
		p.log.info(c.dim('(empty state)'))
		return
	}

	const lines = ids.map((id) => {
		const r = state.resources[id]
		if (!r) return ''
		const phase = r.phase ?? '-'
		const last = r.lastApplied
			? new Date(r.lastApplied).toISOString().replace('T', ' ').slice(0, 19)
			: '-'
		return `  ${c.cyan(pad(id, 28))} ${c.dim(pad(r.kind, 32))} ${c.dim(`[${phase}]`)} ${c.dim(last)}`
	})

	p.log.info(`${c.bold('State')}: ${ids.length} resource(s)`)
	block('Resources', lines.join('\n'))
}
