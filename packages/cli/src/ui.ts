// Shared color + symbol helpers for the CLI.
//
// picocolors auto-disables when stdout isn't a TTY (or NO_COLOR is set), so
// these helpers are safe to use unconditionally.

import pc from 'picocolors'

export const c = pc

export const symbols = {
	create: pc.green('+'),
	update: pc.yellow('~'),
	replace: pc.magenta('!'),
	destroy: pc.red('-'),
	noop: pc.dim('·'),
	unknown: pc.dim('?'),
}

const ACTION_LABELS: Record<string, string> = {
	create: pc.green('create '),
	update: pc.yellow('update '),
	replace: pc.magenta('replace'),
	destroy: pc.red('destroy'),
	'no-op': pc.dim('no-op  '),
}

export function actionLabel(type: string): string {
	return ACTION_LABELS[type] ?? pc.dim('unknown')
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
			return pc.green(text)
		case 'update':
			return pc.yellow(text)
		case 'replace':
			return pc.magenta(text)
		case 'destroy':
			return pc.red(text)
		case 'no-op':
			return pc.dim(text)
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
