// @db-x/snapshot-pg-dump — a pg_dump-backed SnapshotDriver.
//
// Captures the schema (or full data) of a Postgres database to a local store
// directory, one `.sql` artifact per snapshot plus an `index.json` manifest.
// Each ref is pinned to the state revision (`.dbx/state.json`'s lastApplied)
// it was taken from, so #7's auto-snapshot can link a snapshot to the state
// it can roll back to.
//
// The database is reached through a `RuntimeExec` spawn template — the same
// indirection <Postgres> uses, so this works whether Postgres is a docker
// `compose exec`, an `ssh` host, or a direct local connection.

import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
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
const DRIVER = 'pg-dump'

/** How to reach the database. `<Postgres>` props win over target defaults. */
export interface PgDumpConnection {
	/** Spawn template to a pg_dump/psql-capable shell (docker exec, ssh, direct). */
	exec: RuntimeExec
	user: string
	password: string
	database: string
}

/**
 * Runs one dump or restore command. `dump` streams the child's stdout into
 * `file`; `restore` feeds `file` into the child's stdin. Injectable so tests
 * don't need a live Postgres.
 */
export type SnapshotRunner = (job: {
	command: string
	args: string[]
	env?: Record<string, string | undefined>
	file: string
	direction: 'dump' | 'restore'
}) => Promise<void>

export interface PgDumpDriverConfig {
	connection: PgDumpConnection
	/** Directory the `.sql` artifacts and `index.json` live in. Created on demand. */
	storeDir: string
	/** Default capture mode. Defaults to `schema`. */
	mode?: SnapshotMode
	/** Command runner. Defaults to a real `child_process.spawn` to/from `file`. */
	run?: SnapshotRunner
	/** Clock. Defaults to `() => new Date().toISOString()`. Injectable for tests. */
	now?: () => string
}

export function createPgDumpDriver(config: PgDumpDriverConfig): SnapshotDriver {
	const { connection, storeDir } = config
	const defaultMode: SnapshotMode = config.mode ?? 'schema'
	const run = config.run ?? defaultRunner
	const now = config.now ?? (() => new Date().toISOString())

	const indexPath = path.join(storeDir, INDEX_FILE)
	const artifactPath = (id: string): string => path.join(storeDir, `${id}.sql`)

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

	// Env carries the password so it never lands on the command line (visible
	// in `ps`). PGPASSWORD is honored by both pg_dump and psql.
	const commandEnv = { ...connection.exec.env, PGPASSWORD: connection.password }

	return {
		async create(stateRev: string): Promise<SnapshotRef> {
			const createdAt = now()
			const id = makeId(createdAt)
			const mode = defaultMode
			await fs.mkdir(storeDir, { recursive: true })

			const dumpArgs = ['pg_dump', '-U', connection.user, '-d', connection.database]
			if (mode === 'schema') dumpArgs.push('--schema-only')

			await run({
				command: connection.exec.command,
				args: [...connection.exec.args, ...dumpArgs],
				env: commandEnv,
				file: artifactPath(id),
				direction: 'dump',
			})

			const ref: SnapshotRef = { id, stateRev, createdAt, driver: DRIVER, mode }
			await writeIndex([...(await readIndex()), ref])
			return ref
		},

		async restore(ref: SnapshotRef): Promise<void> {
			await run({
				command: connection.exec.command,
				args: [
					...connection.exec.args,
					'psql',
					'-U',
					connection.user,
					'-d',
					connection.database,
					'-v',
					'ON_ERROR_STOP=1',
				],
				env: commandEnv,
				file: artifactPath(ref.id),
				direction: 'restore',
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

// ISO timestamps are sortable, but `:` is illegal in filenames on some hosts.
// ponytail: id == sanitized createdAt; two snapshots within the same clock
// tick would collide. Add a counter/suffix if sub-second cadence ever matters.
function makeId(createdAt: string): string {
	return `snap-${createdAt.replace(/[:.]/g, '-')}`
}

// ─────────────────────────────────────────────────────────────────────────────
//  Default runner — real child_process.spawn, stdout→file / file→stdin.
// ─────────────────────────────────────────────────────────────────────────────

const defaultRunner: SnapshotRunner = ({ command, args, env, file, direction }) =>
	new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			env: env ? { ...process.env, ...env } : process.env,
			stdio: [
				direction === 'restore' ? 'pipe' : 'ignore',
				direction === 'dump' ? 'pipe' : 'ignore',
				'pipe',
			],
		})

		let stderr = ''
		child.stderr?.setEncoding('utf8')
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk
		})

		if (direction === 'dump' && child.stdout) {
			const out = createWriteStream(file)
			child.stdout.pipe(out)
			out.on('error', reject)
		}
		if (direction === 'restore' && child.stdin) {
			const src = createReadStream(file)
			src.on('error', reject)
			src.pipe(child.stdin)
		}

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
			resolve()
		})
	})
