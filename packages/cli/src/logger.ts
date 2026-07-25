// Per-resource loggers used in Ctx.
//
// `makeLogger` is the non-interactive default: prefixed, colored lines on
// stdout. `makeInteractiveLogger` routes through clack's `log` helpers so
// messages render above an active spinner without breaking it.

import * as p from '@clack/prompts'
import type { CtxLogger } from '@db-x/runtime'
import { c } from './ui.js'

const DEBUG_ENABLED = (process.env.DEBUG ?? '').includes('db-x')

export function makeLogger(scope: string): CtxLogger {
	const prefix = c.dim(`[${scope}]`)
	return {
		info: (msg, data) => console.log(prefix, msg, data === undefined ? '' : data),
		warn: (msg, data) =>
			console.warn(prefix, c.yellow('WARN'), msg, data === undefined ? '' : data),
		error: (msg, data) =>
			console.error(prefix, c.red('ERROR'), msg, data === undefined ? '' : data),
		debug: (msg, data) => {
			if (DEBUG_ENABLED) {
				console.log(prefix, c.dim('(debug)'), msg, data === undefined ? '' : data)
			}
		},
	}
}

export function makeInteractiveLogger(scope: string): CtxLogger {
	const prefix = c.dim(`[${scope}]`)
	const fmt = (msg: string, data: unknown): string =>
		data === undefined ? `${prefix} ${msg}` : `${prefix} ${msg} ${formatData(data)}`
	return {
		info: (msg, data) => p.log.info(fmt(msg, data)),
		warn: (msg, data) => p.log.warn(fmt(msg, data)),
		error: (msg, data) => p.log.error(fmt(msg, data)),
		debug: (msg, data) => {
			if (DEBUG_ENABLED) p.log.message(c.dim(fmt(msg, data)))
		},
	}
}

function formatData(data: unknown): string {
	if (typeof data === 'string') return data
	try {
		return c.dim(JSON.stringify(data))
	} catch {
		return c.dim(String(data))
	}
}
