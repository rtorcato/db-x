// Shared color + symbol helpers for the CLI.
//
// picocolors auto-disables when stdout isn't a TTY (or NO_COLOR is set), so
// these helpers are safe to use unconditionally.

import pc from 'picocolors'

/**
 * picocolors, with the four status colors remapped to their bright variants.
 *
 * The standard ANSI 31/32/33/35 render as muddy brick, moss and olive against
 * the dark backgrounds most terminals ship with — a plan came out looking
 * uniformly greyed-out. Remapping once here means every `c.red(...)` across
 * the CLI reads well without dotting `Bright` through ~30 call sites.
 */
export const c = {
	...pc,
	red: pc.redBright,
	green: pc.greenBright,
	yellow: pc.yellowBright,
	magenta: pc.magentaBright,
}

// `no-op` is the deliberate exception: it *should* recede, because it means
// "nothing happens to this resource".
export const symbols = {
	create: c.green('+'),
	update: c.yellow('~'),
	replace: c.magenta('!'),
	destroy: c.red('-'),
	noop: c.dim('·'),
	unknown: c.dim('?'),
}

const ACTION_LABELS: Record<string, string> = {
	create: c.green('create '),
	update: c.yellow('update '),
	replace: c.magenta('replace'),
	destroy: c.red('destroy'),
	'no-op': c.dim('no-op  '),
}

export function actionLabel(type: string): string {
	return ACTION_LABELS[type] ?? c.dim('unknown')
}

export function actionSymbol(type: string): string {
	switch (type) {
		case 'create':
			return symbols.create
		case 'update':
			return symbols.update
		case 'replace':
			return symbols.replace
		case 'destroy':
			return symbols.destroy
		case 'no-op':
			return symbols.noop
		default:
			return symbols.unknown
	}
}

export function actionColor(type: string, text: string): string {
	switch (type) {
		case 'create':
			return c.green(text)
		case 'update':
			return c.yellow(text)
		case 'replace':
			return c.magenta(text)
		case 'destroy':
			return c.red(text)
		case 'no-op':
			return c.dim(text)
		default:
			return text
	}
}

export function pad(s: string, n: number): string {
	// Padding ignores ANSI escapes — callers should pass raw text.
	return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

export const banner = (): string =>
	`${pc.bold(pc.cyan('db-x'))} ${pc.dim('— JSX as the deployment language')}`
