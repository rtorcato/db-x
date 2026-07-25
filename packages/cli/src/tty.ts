// TTY-aware helpers shared across CLI commands.
//
// clack's spinners and selects assume a real terminal. In CI, when the user
// pipes our output (`db-x apply ./infra.tsx | tee log.txt`), or any other
// non-TTY context, those interactive UI calls misbehave — spinners spam
// cursor escape sequences, selects hang waiting for input that will never
// come. Use the helpers below to keep the non-interactive path clean.

import process from 'node:process'

/**
 * True when stdout is attached to a terminal.
 *
 * Default surface is `process.stdout.isTTY`, which Node sets to `undefined`
 * for pipes / redirects / Docker logs. We coerce to a strict boolean so
 * callers can use `if (isInteractive())` without lint complaints.
 *
 * The optional `stream` parameter is for tests — pass a fake `{ isTTY }`
 * shape to drive the branch.
 */
export function isInteractive(stream: { isTTY?: boolean } = process.stdout): boolean {
	return Boolean(stream.isTTY)
}

/** Minimal spinner interface that matches what clack returns. */
export interface Spinner {
	start: (msg: string) => void
	stop: (msg: string, code?: number) => void
	message: (msg: string) => void
}

/**
 * Returns a TTY-safe spinner.
 *
 * In interactive contexts we hand back `realSpinner` (typically
 * `p.spinner()` from `@clack/prompts`). In non-TTY contexts we hand back a
 * plain logger that prints each transition on its own line — no cursor
 * tricks, safe to pipe.
 */
export function makeSpinner(realSpinner: () => Spinner): Spinner {
	if (isInteractive()) return realSpinner()
	return {
		start: (msg) => console.log(`${msg}...`),
		stop: (msg) => console.log(msg),
		message: (msg) => console.log(msg),
	}
}

/**
 * Write `message` to stderr and exit with code 1.
 *
 * Used to short-circuit interactive prompts (clack `select` / `confirm` /
 * `text`) when the CLI is running non-interactively. The message should
 * tell the user how to provide the missing input on the command line.
 */
export function failNonInteractive(message: string): never {
	process.stderr.write(`db-x: ${message}\n`)
	process.exit(1)
}
