#!/usr/bin/env node
// @db-x/cli — entry point.
//
// Argument parsing is intentionally small. Supported forms:
//   db-x <command> [file] [--yes|-y]
//   db-x                  → interactive menu
//   db-x help             → colored help screen

import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as p from '@clack/prompts'
import { applyCommand } from './commands/apply.js'
import { describeCommand } from './commands/describe.js'
import { destroyCommand } from './commands/destroy.js'
import { previewCommand } from './commands/preview.js'
import { refreshCommand } from './commands/refresh.js'
import { restoreCommand } from './commands/restore.js'
import { stateCommand } from './commands/state.js'
import { failNonInteractive, isInteractive } from './tty.js'
import { banner, c } from './ui.js'

export const COMMANDS = [
	'preview',
	'apply',
	'refresh',
	'destroy',
	'restore',
	'state',
	'describe',
	'help',
] as const
export type Command = (typeof COMMANDS)[number]

export interface ParsedArgs {
	command: Command | null
	rawCommand: string | null
	file: string | null
	yes: boolean
	phase: string | undefined
	allowDestructive: boolean
	noSnapshot: boolean
	/** Explicit snapshot id for `db-x restore` (`--snapshot <id>`). */
	snapshot: string | undefined
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2)
	const positional: string[] = []
	let yes = false
	let phase: string | undefined
	let allowDestructive = false
	let noSnapshot = false
	let snapshot: string | undefined

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string // safe: i < args.length
		if (arg === '--yes' || arg === '-y') {
			yes = true
		} else if (arg === '--allow-destructive') {
			allowDestructive = true
		} else if (arg === '--no-snapshot') {
			noSnapshot = true
		} else if (arg.startsWith('--snapshot=')) {
			snapshot = arg.slice('--snapshot='.length)
		} else if (arg === '--snapshot' && i + 1 < args.length) {
			i++
			snapshot = args[i] as string
		} else if (arg === '-h' || arg === '--help') {
			positional.unshift('help')
		} else if (arg === '--json') {
			// `describe` always outputs JSON. The flag is accepted as a no-op
			// so `db-x describe --json` matches the documented contract and
			// future commands can opt into a different default.
		} else if (arg.startsWith('--phase=')) {
			phase = arg.slice('--phase='.length)
		} else if (arg === '--phase' && i + 1 < args.length) {
			i++
			phase = args[i] as string
		} else {
			positional.push(arg)
		}
	}

	const [cmd, file] = positional
	const command = isCommand(cmd) ? cmd : null
	return {
		command,
		rawCommand: cmd ?? null,
		file: file ?? null,
		yes,
		phase,
		allowDestructive,
		noSnapshot,
		snapshot,
	}
}

function isCommand(value: string | undefined): value is Command {
	return value !== undefined && (COMMANDS as readonly string[]).includes(value)
}

async function main(): Promise<void> {
	const workDir = process.cwd()
	const parsed = parseArgs(process.argv)

	// `describe` is special: its stdout is JSON only. Run it before the
	// clack banner / intro to keep stdout clean and pipeable to jq.
	if (parsed.command === 'describe') {
		const file = parsed.file ? path.resolve(parsed.file) : null
		if (!file) {
			process.stderr.write('db-x describe: missing required <file> argument\n')
			process.exit(1)
		}
		await describeCommand({ file, workDir })
		return
	}

	p.intro(banner())

	if (parsed.command === 'help') {
		printHelp()
		p.outro(c.dim('See docs at docs/architecture.md'))
		return
	}

	if (parsed.command === null && parsed.rawCommand !== null) {
		p.log.error(`Unknown command: ${c.bold(parsed.rawCommand)}`)
		printHelp()
		p.outro(c.red('Failed.'))
		process.exit(1)
	}

	const command = parsed.command ?? (await pickCommand())
	if (command === null) return

	switch (command) {
		case 'state':
			await stateCommand({ workDir })
			p.outro(c.dim('done'))
			return
		case 'preview': {
			const file = await resolveFile(parsed.file, workDir, 'preview')
			if (!file) return
			await previewCommand({ file, workDir })
			p.outro(c.dim('Preview complete.'))
			return
		}
		case 'apply': {
			const file = await resolveFile(parsed.file, workDir, 'apply')
			if (!file) return
			await applyCommand({
				file,
				workDir,
				yes: parsed.yes,
				phase: parsed.phase,
				allowDestructive: parsed.allowDestructive,
				noSnapshot: parsed.noSnapshot,
			})
			return
		}
		case 'refresh': {
			const file = await resolveFile(parsed.file, workDir, 'refresh')
			if (!file) return
			await refreshCommand({ file, workDir })
			p.outro(c.dim('Refresh complete.'))
			return
		}
		case 'destroy': {
			const file = await resolveFile(parsed.file, workDir, 'destroy')
			if (!file) return
			await destroyCommand({ file, workDir, yes: parsed.yes, phase: parsed.phase })
			return
		}
		case 'restore':
			// No file needed — connection + snapshot pin both come from .dbx/.
			await restoreCommand({ workDir, yes: parsed.yes, snapshot: parsed.snapshot })
			return
		case 'describe':
			// Unreachable: handled by the pre-banner early-return above so its
			// JSON output stays clean. Listed here for exhaustiveness.
			return
		case 'help':
			printHelp()
			p.outro(c.dim('See docs at docs/architecture.md'))
			return
	}
}

async function pickCommand(): Promise<Command | null> {
	if (!isInteractive()) {
		failNonInteractive(
			'non-interactive stdout: specify a command — preview | apply | refresh | destroy | restore | state | describe | help. Run `db-x help` for usage.'
		)
	}
	const choice = await p.select({
		message: 'What would you like to do?',
		options: [
			{ value: 'preview', label: c.cyan('preview'), hint: 'show the diff, no execution' },
			{ value: 'apply', label: c.green('apply'), hint: 'execute changes against state' },
			{ value: 'refresh', label: c.yellow('refresh'), hint: 'read live infra, surface drift' },
			{ value: 'destroy', label: c.red('destroy'), hint: 'tear everything down' },
			{ value: 'restore', label: c.blue('restore'), hint: 'roll the database back to a snapshot' },
			{ value: 'state', label: c.magenta('state'), hint: 'show the current state file' },
			{ value: 'help', label: c.dim('help'), hint: 'show CLI usage' },
		],
	})
	if (p.isCancel(choice)) {
		p.cancel('Bye.')
		return null
	}
	return choice as Command
}

async function resolveFile(
	provided: string | null,
	workDir: string,
	cmd: string
): Promise<string | null> {
	if (provided) return path.resolve(provided)

	if (!isInteractive()) {
		failNonInteractive(
			`non-interactive stdout: pass the deployment file as an argument. Usage: db-x ${cmd} <file>`
		)
	}

	const candidates = await findJsxFiles(workDir)
	if (candidates.length === 0) {
		return await promptForFile(cmd)
	}

	const choice = await p.select({
		message: `Pick a deployment file for ${c.bold(cmd)}`,
		options: [
			...candidates.map((f) => ({ value: f, label: path.relative(workDir, f) || f })),
			{ value: '__other__', label: c.dim('Enter a different path…') },
		],
	})
	if (p.isCancel(choice)) {
		p.cancel(`${cmd} cancelled.`)
		return null
	}
	if (choice === '__other__') {
		return await promptForFile(cmd)
	}
	return choice as string
}

async function promptForFile(cmd: string): Promise<string | null> {
	const typed = await p.text({
		message: `Path to your deployment file for ${c.bold(cmd)}`,
		placeholder: './deploy.tsx',
		validate: (v) => (v.trim() === '' ? 'Required.' : undefined),
	})
	if (p.isCancel(typed)) {
		p.cancel(`${cmd} cancelled.`)
		return null
	}
	return path.resolve(typed as string)
}

async function findJsxFiles(workDir: string): Promise<string[]> {
	const out: string[] = []
	const seen = new Set<string>()
	const skip = new Set(['node_modules', '.git', 'dist', '.dbx', 'OLD'])

	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > 3) return
		let entries: import('node:fs').Dirent[]
		try {
			entries = await fs.readdir(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') && entry.name !== '.') continue
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				if (skip.has(entry.name)) continue
				await walk(full, depth + 1)
			} else if ((entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) && !seen.has(full)) {
				seen.add(full)
				out.push(full)
			}
		}
	}

	await walk(workDir, 0)
	return out.slice(0, 20)
}

function printHelp(): void {
	const lines = [
		`${c.bold('Usage')}`,
		`  ${c.cyan('db-x')} ${c.bold('preview')} ${c.dim('<file>')}    Render JSX, diff against state, print the plan`,
		`  ${c.cyan('db-x')} ${c.bold('apply')}   ${c.dim('<file>')}    Render, diff, execute changes, persist state`,
		`  ${c.cyan('db-x')} ${c.bold('refresh')} ${c.dim('<file>')}    Re-read live infra, update state outputs, surface drift`,
		`  ${c.cyan('db-x')} ${c.bold('destroy')} ${c.dim('<file>')}    Tear down everything in state (reverse order)`,
		`  ${c.cyan('db-x')} ${c.bold('restore')}            Roll the database back to a pre-apply snapshot`,
		`  ${c.cyan('db-x')} ${c.bold('state')}              Print the contents of .dbx/state.json`,
		`  ${c.cyan('db-x')} ${c.bold('describe')} ${c.dim('<file>')}   Dump graph + state + plan as JSON (LLM-optimized; pipe to jq)`,
		`  ${c.cyan('db-x')} ${c.bold('help')}               Show this message`,
		'',
		`${c.bold('Flags')}`,
		`  ${c.yellow('--yes')}, ${c.yellow('-y')}            Skip confirmation prompts (for CI)`,
		`  ${c.yellow('--phase')} ${c.dim('<phase>')}        Run only the named phase (setup, monitoring, backup, teardown)`,
		`  ${c.yellow('--allow-destructive')}    Permit destructive DDL (DROP, ALTER TYPE) on unprotected resources`,
		`  ${c.yellow('--no-snapshot')}          Skip the pre-flight snapshot taken before destructive DDL on apply`,
		`  ${c.yellow('--snapshot')} ${c.dim('<id>')}       restore: pick a snapshot by id (default: the one pinned to state)`,
		'',
		`${c.bold('Environment')}`,
		`  ${c.magenta('DEBUG=db-x')}      Enable debug logging`,
		'',
		c.dim('Run `db-x` with no arguments for an interactive menu.'),
	]
	p.note(lines.join('\n'), c.bold('db-x — JSX as the deployment language'))
}

/**
 * True when this module is the process entrypoint. Importing it (e.g. from
 * tests) must not trigger `main()`.
 *
 * `argv1` has to be resolved through symlinks before comparing. pnpm's
 * `node_modules/.bin/db-x` shim invokes the CLI through the workspace link
 * (`…/node_modules/@db-x/cli/dist/index.js`), while `import.meta.filename` is
 * always the realpath (`…/packages/cli/dist/index.js`). Comparing them raw
 * made every `pnpm preview` / `pnpm apply` in `examples/` — the commands the
 * READMEs tell you to run — exit 0 having done absolutely nothing.
 *
 * `realpath` is injected so this is testable without a real symlink.
 */
export function isEntrypoint(
	moduleFilename: string,
	argv1: string | undefined,
	realpath: (p: string) => string
): boolean {
	if (argv1 === undefined) return false
	try {
		return moduleFilename === realpath(argv1)
	} catch {
		// argv[1] doesn't exist on disk (`node --eval`, an odd embedder): not us.
		return false
	}
}

if (isEntrypoint(import.meta.filename, process.argv[1], realpathSync)) {
	main().catch((err: Error) => {
		p.log.error(`${c.red('Error')}: ${err.message ?? err}`)
		if (process.env.DEBUG?.includes('db-x') && err.stack) {
			process.stderr.write(`${err.stack}\n`)
		}
		p.outro(c.red('Failed.'))
		process.exit(1)
	})
}
