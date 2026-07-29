import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	COMMANDS,
	DEFAULT_FILE,
	conventionalFile,
	isEntrypoint,
	parseArgs,
	resolveFile,
} from './index.js'

// parseArgs is the CLI's contract surface. Tests below pin the behavior
// against the documented forms in index.ts:
//   db-x <command> [file] [--yes|-y] [--phase=<name>] [--json]
//   db-x                  → interactive menu (command === null, rawCommand === null)
//   db-x help             → command === 'help'

function argv(...args: string[]): string[] {
	// Mimic process.argv shape: [node, script, ...userArgs]
	return ['node', 'db-x', ...args]
}

describe('parseArgs', () => {
	describe('positional commands', () => {
		it.each(COMMANDS.map((c) => [c]))('recognizes %s as a known command', (cmd) => {
			const parsed = parseArgs(argv(cmd))
			expect(parsed.command).toBe(cmd)
			expect(parsed.rawCommand).toBe(cmd)
		})

		it('returns null command + null rawCommand when no positional given', () => {
			const parsed = parseArgs(argv())
			expect(parsed.command).toBeNull()
			expect(parsed.rawCommand).toBeNull()
		})

		it('marks an unknown command with rawCommand set but command null', () => {
			const parsed = parseArgs(argv('frobnicate'))
			expect(parsed.command).toBeNull()
			expect(parsed.rawCommand).toBe('frobnicate')
		})

		it('captures the file as the second positional', () => {
			const parsed = parseArgs(argv('apply', './infra.tsx'))
			expect(parsed.command).toBe('apply')
			expect(parsed.file).toBe('./infra.tsx')
		})

		it('leaves file null when only the command is given', () => {
			const parsed = parseArgs(argv('preview'))
			expect(parsed.file).toBeNull()
		})
	})

	describe('--yes / -y flag', () => {
		it('defaults to false', () => {
			expect(parseArgs(argv('apply', './infra.tsx')).yes).toBe(false)
		})

		it('is set by --yes', () => {
			expect(parseArgs(argv('apply', './infra.tsx', '--yes')).yes).toBe(true)
		})

		it('is set by -y', () => {
			expect(parseArgs(argv('apply', './infra.tsx', '-y')).yes).toBe(true)
		})

		it('works regardless of position relative to the file', () => {
			expect(parseArgs(argv('apply', '--yes', './infra.tsx')).yes).toBe(true)
			expect(parseArgs(argv('--yes', 'apply', './infra.tsx')).yes).toBe(true)
		})
	})

	describe('--allow-destructive flag', () => {
		it('defaults to false', () => {
			expect(parseArgs(argv('apply', './infra.tsx')).allowDestructive).toBe(false)
		})

		it('is set by --allow-destructive', () => {
			expect(parseArgs(argv('apply', './infra.tsx', '--allow-destructive')).allowDestructive).toBe(
				true
			)
		})
	})

	describe('--no-snapshot flag', () => {
		it('defaults to false', () => {
			expect(parseArgs(argv('apply', './infra.tsx')).noSnapshot).toBe(false)
		})

		it('is set by --no-snapshot', () => {
			expect(parseArgs(argv('apply', './infra.tsx', '--no-snapshot')).noSnapshot).toBe(true)
		})
	})

	describe('--phase', () => {
		it('defaults to undefined', () => {
			expect(parseArgs(argv('apply', './infra.tsx')).phase).toBeUndefined()
		})

		it('parses --phase=<name>', () => {
			expect(parseArgs(argv('apply', './infra.tsx', '--phase=setup')).phase).toBe('setup')
		})

		it('parses --phase <name> as two args', () => {
			expect(parseArgs(argv('apply', './infra.tsx', '--phase', 'monitoring')).phase).toBe(
				'monitoring'
			)
		})

		it('does not consume the next arg when --phase is the last token', () => {
			const parsed = parseArgs(argv('apply', './infra.tsx', '--phase'))
			expect(parsed.phase).toBeUndefined()
			// The trailing --phase isn't pushed as a positional either.
			expect(parsed.file).toBe('./infra.tsx')
		})
	})

	describe('--snapshot flag', () => {
		it('defaults to undefined', () => {
			expect(parseArgs(argv('restore')).snapshot).toBeUndefined()
		})

		it('parses --snapshot=<id>', () => {
			expect(parseArgs(argv('restore', '--snapshot=snap-123')).snapshot).toBe('snap-123')
		})

		it('parses --snapshot <id> as two args', () => {
			expect(parseArgs(argv('restore', '--snapshot', 'snap-123')).snapshot).toBe('snap-123')
		})

		it('does not consume the next arg when --snapshot is the last token', () => {
			expect(parseArgs(argv('restore', '--snapshot')).snapshot).toBeUndefined()
		})
	})

	describe('--json', () => {
		it('is accepted as a no-op (does not become a positional)', () => {
			const parsed = parseArgs(argv('describe', './infra.tsx', '--json'))
			expect(parsed.command).toBe('describe')
			expect(parsed.file).toBe('./infra.tsx')
		})
	})

	describe('-h / --help', () => {
		it('promotes -h to the help command', () => {
			expect(parseArgs(argv('-h')).command).toBe('help')
		})

		it('promotes --help to the help command', () => {
			expect(parseArgs(argv('--help')).command).toBe('help')
		})

		it('treats -h as taking precedence over a later positional', () => {
			// The current implementation unshifts 'help' to the front; document that.
			const parsed = parseArgs(argv('apply', '-h'))
			expect(parsed.command).toBe('help')
		})
	})
})

describe('isEntrypoint', () => {
	// pnpm's node_modules/.bin/db-x shim invokes the CLI through the workspace
	// link, so argv[1] is the symlinked path while import.meta.filename is the
	// realpath. Comparing them raw made `pnpm preview` exit 0 in silence.
	const REAL = '/repo/packages/cli/dist/index.js'
	const LINKED = '/repo/examples/sqlite/node_modules/@db-x/cli/dist/index.js'
	const realpath = (p: string): string => (p === LINKED ? REAL : p)

	it('is true when argv[1] is the module itself', () => {
		expect(isEntrypoint(REAL, REAL, realpath)).toBe(true)
	})

	it('is true when argv[1] reaches the module through a symlink', () => {
		expect(isEntrypoint(REAL, LINKED, realpath)).toBe(true)
	})

	it('is false when argv[1] is a different module', () => {
		expect(isEntrypoint(REAL, '/repo/other/bin.js', realpath)).toBe(false)
	})

	it('is false when there is no argv[1] (imported, not executed)', () => {
		expect(isEntrypoint(REAL, undefined, realpath)).toBe(false)
	})

	it('is false when argv[1] cannot be resolved on disk', () => {
		expect(
			isEntrypoint(REAL, '/gone', () => {
				throw new Error('ENOENT')
			})
		).toBe(false)
	})
})

// `dbx.tsx` in the working directory is the entry every example and scaffold
// uses, so the commands take it without an argument. These drive the real
// filesystem against a temp dir — both cases return before any prompt, so they
// stay deterministic in the non-TTY test runner.
describe('conventionalFile / resolveFile default', () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-x-default-'))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it('finds dbx.tsx in the working directory', async () => {
		const entry = path.join(dir, DEFAULT_FILE)
		await fs.writeFile(entry, 'export default null\n')
		expect(await conventionalFile(dir)).toBe(entry)
	})

	it('is null when the directory has no dbx.tsx', async () => {
		await fs.writeFile(path.join(dir, 'other.tsx'), 'export default null\n')
		expect(await conventionalFile(dir)).toBeNull()
	})

	it('ignores a *directory* named dbx.tsx', async () => {
		await fs.mkdir(path.join(dir, DEFAULT_FILE))
		expect(await conventionalFile(dir)).toBeNull()
	})

	it('resolveFile falls back to dbx.tsx when no file is given', async () => {
		const entry = path.join(dir, DEFAULT_FILE)
		await fs.writeFile(entry, 'export default null\n')
		expect(await resolveFile(null, dir, 'apply')).toBe(entry)
	})

	it('resolveFile still prefers an explicit path over the default', async () => {
		await fs.writeFile(path.join(dir, DEFAULT_FILE), 'export default null\n')
		const explicit = path.join(dir, 'other.tsx')
		await fs.writeFile(explicit, 'export default null\n')
		expect(await resolveFile(explicit, dir, 'apply')).toBe(explicit)
	})
})
