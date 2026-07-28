// @db-x/snapshot-sqlite — a `sqlite3 .backup`-backed SnapshotDriver.
//
// Captures a SQLite database to a local store directory, one `.db` copy per
// snapshot plus an `index.json` manifest. Each ref is pinned to the state
// revision (`.dbx/state.json`'s lastApplied) it was taken from.
//
// Uses sqlite3's `.backup` / `.restore` dot-commands rather than copying the
// file: the online backup API they wrap takes a consistent copy of a database
// that is being written to, and accounts for `-wal` / `-shm` sidecars. A plain
// `fs.copyFile` of a WAL-mode database can capture a torn page or silently
// lose committed transactions still living in the WAL.

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type {
	PrunePolicy,
	RuntimeExec,
	SnapshotDriver,
	SnapshotMode,
	SnapshotRef,
} from '@db-x/runtime'

const INDEX_FILE = 'index.json'
const DRIVER = 'sqlite-backup'

/** How to reach the database. */
export interface SqliteConnection {
	/** Spawn template for `sqlite3`, as published by `<Sqlite>`. */
	exec: RuntimeExec
	/** Absolute path to the `.db` file. */
	file: string
}

/** Runs one sqlite3 invocation. Injectable so tests don't need the binary. */
export type SnapshotRunner = (job: {
	command: string
	args: string[]
	env?: Record<string, string | undefined>
}) => Promise<void>

export interface SqliteDriverConfig {
	connection: SqliteConnection
	/** Directory the `.db` artifacts and `index.json` live in. Created on demand. */
	storeDir: string
	/**
	 * Capture mode. Only `full` is supported: a SQLite database *is* one file,
	 * so a copy of it necessarily contains the rows. Passing `schema` throws
	 * rather than pretending the distinction exists.
	 */
	mode?: SnapshotMode
	/** Command runner. Defaults to a real `child_process.spawn`. */
	run?: SnapshotRunner
	/** Clock. Defaults to `() => new Date().toISOString()`. Injectable for tests. */
	now?: () => string
}

export function createSqliteDriver(config: SqliteDriverConfig): SnapshotDriver {
	const { connection, storeDir } = config
	if (config.mode === 'schema') {
		throw new Error(
			"@db-x/snapshot-sqlite: mode 'schema' is not supported — a SQLite database is a single file, so a snapshot of it always contains the rows. Use 'full'."
		)
	}
	const mode: SnapshotMode = 'full'
	const run = config.run ?? defaultRunner
	const now = config.now ?? (() => new Date().toISOString())

	const indexPath = path.join(storeDir, INDEX_FILE)
	const artifactPath = (id: string): string => path.join(storeDir, `${id}.db`)

	async function readIndex(): Promise<SnapshotRef[]> {
		try {
			const raw = await fs.readFile(indexPath, 'utf-8')
			return JSON.parse(raw) as SnapshotRef[]
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
			throw err
		}
	}

	async function writeIndex(refs: SnapshotRef[]): Promise<void> {
		await fs.mkdir(storeDir, { recursive: true })
		await fs.writeFile(indexPath, `${JSON.stringify(refs, null, 2)}\n`)
	}

	/** Newest first. */
	function byNewest(refs: SnapshotRef[]): SnapshotRef[] {
		return [...refs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
	}

	return {
		async create(stateRev: string): Promise<SnapshotRef> {
			const createdAt = now()
			const id = makeId(createdAt)
			await fs.mkdir(storeDir, { recursive: true })

			await run({
				command: connection.exec.command,
				args: [...connection.exec.args, connection.file, dotCommand('.backup', artifactPath(id))],
				env: connection.exec.env,
			})

			const ref: SnapshotRef = { id, stateRev, createdAt, driver: DRIVER, mode }
			await writeIndex([...(await readIndex()), ref])
			return ref
		},

		async restore(ref: SnapshotRef): Promise<void> {
			const artifact = artifactPath(ref.id)
			// This check is load-bearing, not defensive. Verified against sqlite
			// 3.x: `.restore <missing-file>` exits 0, prints nothing to stderr,
			// and leaves the live database EMPTY — it opens the missing path as a
			// fresh blank database and faithfully copies that over the target. A
			// pruned or hand-deleted artifact would silently destroy the data the
			// user was trying to recover.
			await fs.access(artifact).catch(() => {
				throw new Error(
					`Snapshot artifact ${artifact} is missing. Refusing to restore: sqlite3 would silently replace ${connection.file} with an empty database.`
				)
			})
			await run({
				command: connection.exec.command,
				args: [...connection.exec.args, connection.file, dotCommand('.restore', artifact)],
				env: connection.exec.env,
			})
		},

		async list(): Promise<SnapshotRef[]> {
			return byNewest(await readIndex())
		},

		async prune(policy: PrunePolicy): Promise<SnapshotRef[]> {
			const keep = Math.max(0, policy.keepLast)
			const ordered = byNewest(await readIndex())
			const removed = ordered.slice(keep)
			for (const ref of removed) {
				await fs.rm(artifactPath(ref.id), { force: true })
			}
			await writeIndex(ordered.slice(0, keep))
			return removed
		},
	}
}

/**
 * Build a `.backup '<path>'` / `.restore '<path>'` dot-command.
 *
 * sqlite3 parses dot-command arguments with its own shell-like splitter, so a
 * path containing spaces has to be quoted *inside* the single argv entry.
 * Single quotes are the safe wrapper; a literal `'` in the path is doubled,
 * the same escape SQL string literals use.
 */
export function dotCommand(command: '.backup' | '.restore', file: string): string {
	return `${command} '${file.replace(/'/g, "''")}'`
}

// ISO timestamps are sortable, but `:` is illegal in filenames on some hosts.
// ponytail: id == sanitized createdAt; two snapshots within the same clock
// tick would collide. Add a counter/suffix if sub-second cadence ever matters.
function makeId(createdAt: string): string {
	return `snap-${createdAt.replace(/[:.]/g, '-')}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  Default runner — real child_process.spawn.
// ─────────────────────────────────────────────────────────────────────────────
//
// Simpler than the pg_dump / mongodump runners: sqlite3 writes the artifact
// itself, so there is no stdout/stdin plumbing to do.

const defaultRunner: SnapshotRunner = ({ command, args, env }) =>
	new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			env: env ? { ...process.env, ...env } : process.env,
			stdio: ['ignore', 'ignore', 'pipe'],
		})

		let stderr = ''
		child.stderr?.setEncoding('utf8')
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk
		})

		child.on('error', (err) => reject(new Error(`${command}: ${err.message}`)))
		child.on('close', (code, sig) => {
			if (sig) {
				reject(new Error(`${command} ${args.join(' ')}: terminated by signal ${sig}`))
				return
			}
			if (code !== 0) {
				const tail = stderr.trim().split('\n').slice(-5).join('\n')
				reject(new Error(`${command} ${args.join(' ')} failed (exit ${code}):\n${tail}`))
				return
			}
			// `.backup` to an unwritable path does exit non-zero, but `.restore`
			// failures do not — dot-command error reporting is inconsistent. Treat
			// any stderr output as a failure so nothing slips through on exit 0.
			if (stderr.trim() !== '') {
				reject(new Error(`${command} ${args.join(' ')}: ${stderr.trim()}`))
				return
			}
			resolve()
		})
	})
