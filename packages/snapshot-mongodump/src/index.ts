// @db-x/snapshot-mongodump — a mongodump-backed SnapshotDriver.
//
// Captures a MongoDB database to a local store directory, one gzipped archive
// per snapshot plus an `index.json` manifest. Each ref is pinned to the state
// revision (`.dbx/state.json`'s lastApplied) it was taken from, so #7's
// auto-snapshot can link a snapshot to the state it can roll back to.
//
// The database is reached through a `RuntimeExec` spawn template — the same
// indirection `<Mongo>` uses, so this works whether Mongo is reached directly,
// through a `docker compose exec`, or over `ssh`.
//
// Mirrors @db-x/snapshot-pg-dump's contract; the two differ only in the tools
// they spawn and in what a snapshot can contain (see `mode` below).

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
const DRIVER = 'mongodump'

/** How to reach the database. `uri` is passed to the tools verbatim. */
export interface MongodumpConnection {
	/**
	 * Spawn template to a mongodump/mongorestore-capable shell. The driver
	 * appends the tool itself, so this must be a *wrapper* prefix (`env`,
	 * `docker compose exec -T mongo`, `ssh host`) — not `mongodump`.
	 */
	exec: RuntimeExec
	/** Connection URI — `mongodb://…` or `mongodb+srv://…`. */
	uri: string
	/** Database to capture. Restored into the same name. */
	database: string
}

/**
 * Runs one dump or restore command. `dump` streams the child's stdout into
 * `file`; `restore` feeds `file` into the child's stdin. Injectable so tests
 * don't need a live MongoDB.
 */
export type SnapshotRunner = (job: {
	command: string
	args: string[]
	env?: Record<string, string | undefined>
	file: string
	direction: 'dump' | 'restore'
}) => Promise<void>

export interface MongodumpDriverConfig {
	connection: MongodumpConnection
	/** Directory the archives and `index.json` live in. Created on demand. */
	storeDir: string
	/**
	 * Capture mode. Only `full` is supported: a Mongo collection's "schema" is
	 * its indexes and validator, and mongodump cannot capture those without the
	 * documents. Passing `schema` throws rather than silently capturing data
	 * the caller didn't ask for.
	 */
	mode?: SnapshotMode
	/** Command runner. Defaults to a real `child_process.spawn` to/from `file`. */
	run?: SnapshotRunner
	/** Clock. Defaults to `() => new Date().toISOString()`. Injectable for tests. */
	now?: () => string
}

export function createMongodumpDriver(config: MongodumpDriverConfig): SnapshotDriver {
	const { connection, storeDir } = config
	if (config.mode === 'schema') {
		throw new Error(
			"@db-x/snapshot-mongodump: mode 'schema' is not supported — mongodump cannot capture indexes and validators without the documents. Use 'full'."
		)
	}
	const mode: SnapshotMode = 'full'
	const run = config.run ?? defaultRunner
	const now = config.now ?? (() => new Date().toISOString())

	const indexPath = path.join(storeDir, INDEX_FILE)
	const artifactPath = (id: string): string => path.join(storeDir, `${id}.archive.gz`)

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

			// `--archive` with no value streams the archive to stdout, which the
			// runner pipes into the artifact file — same shape as pg_dump's.
			await run({
				command: connection.exec.command,
				args: [
					...connection.exec.args,
					'mongodump',
					`--uri=${connection.uri}`,
					`--db=${connection.database}`,
					'--archive',
					'--gzip',
					'--quiet',
				],
				env: connection.exec.env,
				file: artifactPath(id),
				direction: 'dump',
			})

			const ref: SnapshotRef = { id, stateRev, createdAt, driver: DRIVER, mode }
			await writeIndex([...(await readIndex()), ref])
			return ref
		},

		async restore(ref: SnapshotRef): Promise<void> {
			// `--drop` drops each collection *present in the archive* before
			// restoring it.
			// ponytail: a collection created after the snapshot survives the
			// restore — same non-clean semantics as the pg_dump driver. A true
			// point-in-time reset needs dropping the database first; add
			// `--drop-database` behind a flag if that becomes the expectation.
			await run({
				command: connection.exec.command,
				args: [
					...connection.exec.args,
					'mongorestore',
					`--uri=${connection.uri}`,
					'--archive',
					'--gzip',
					'--drop',
					`--nsInclude=${connection.database}.*`,
					'--quiet',
				],
				env: connection.exec.env,
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

/**
 * Mask the password inside a `--uri=mongodb://user:pass@…` argument before it
 * reaches an error message. The database tools have no `PGPASSWORD`
 * equivalent, so the URI must go in argv and is visible in `ps` regardless —
 * this only keeps it out of DB-X's own output.
 */
export function redact(args: string[]): string[] {
	return args.map((a) => a.replace(/(mongodb(?:\+srv)?:\/\/[^:/@]+):[^@]*@/, '$1:***@'))
}

// ─────────────────────────────────────────────────────────────────────────────
//  Default runner — real child_process.spawn, stdout→file / file→stdin.
// ─────────────────────────────────────────────────────────────────────────────
//
// Intentionally duplicated from @db-x/snapshot-pg-dump rather than imported:
// each driver package stands alone, and this one additionally masks
// credentials in its error output.

const defaultRunner: SnapshotRunner = ({ command, args, env, file, direction }) =>
	new Promise<void>((resolve, reject) => {
		const shown = (): string => `${command} ${redact(args).join(' ')}`
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
				reject(new Error(`${shown()}: terminated by signal ${sig}`))
				return
			}
			if (code !== 0) {
				const tail = redact(stderr.trim().split('\n')).slice(-5).join('\n')
				reject(new Error(`${shown()} failed (exit ${code}):\n${tail}`))
				return
			}
			resolve()
		})
	})
