// Internal helpers. Runtime-agnostic script execution: the parent
// (`<Mongo>` here) describes how to spawn a command; we append
// `mongosh <uri> --quiet --eval <js>` to it and `child_process.spawn` the
// result.
//
// This is the only file in the package that touches OS-level concerns.
// Components import only from @db-x/runtime + this module.

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Ctx, CtxLogger, RuntimeExec } from '@db-x/runtime'

/**
 * Outputs a `<Mongo>` resource emits — read by child components
 * (`<Collection>`, `<SeedData>`, …) via `ctx.deps[parentId]`.
 *
 * The database field is deliberately named `db`, not `database`: the CLI's
 * `resolveSnapshotConnection` duck-types `{user, password, database, exec}` to
 * find something to `pg_dump`, and a Mongo connection is not dumpable by
 * pg_dump. Staying off that shape makes `db-x apply` refuse a destructive
 * change here ("no connection found to snapshot") instead of shelling out to
 * the wrong tool. Lands properly with a mongodump driver (#42).
 */
export interface MongoParentOutputs {
	/** Database the schema is applied to. Always addressed explicitly. */
	db: string
	/** Full connection URI, passed through to mongosh verbatim. */
	uri: string
	/** Spawn template — `mongosh`, or a wrapper that can reach it. */
	exec: RuntimeExec
}

// ─────────────────────────────────────────────────────────────────────────────
//  Parent lookup
// ─────────────────────────────────────────────────────────────────────────────

export function requireMongoParent(ctx: Ctx, tagName: string): MongoParentOutputs {
	const parent = findMongoParent(ctx)
	if (!parent) {
		throw new Error(
			`<${tagName}> must be a (transitive) child of <Mongo> (from @db-x/mongodb-library). Resource ${ctx.resource.id} has no mongo parent outputs.`
		)
	}
	return parent
}

export function findMongoParent(ctx: Ctx): MongoParentOutputs | null {
	const parentId = ctx.resource.parent
	if (!parentId) return null
	const outputs = ctx.deps[parentId] as Partial<MongoParentOutputs> | undefined
	if (!outputs?.db || !outputs.uri || !outputs.exec?.command || !Array.isArray(outputs.exec.args)) {
		return null
	}
	return outputs as MongoParentOutputs
}

// ─────────────────────────────────────────────────────────────────────────────
//  Script execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bind the target database to `dbx` so every emitted statement addresses it
 * explicitly. Without this, statements would run against whatever default
 * database the URI carries — which differs between a plain URI, an SRV URI,
 * and one with a trailing `/?options`.
 */
export function wrapScript(db: string, js: string): string {
	return `const dbx = globalThis.db.getSiblingDB(${JSON.stringify(db)});\n${js}`
}

/**
 * Run a JS snippet against the database described by `<Mongo>` outputs.
 * `mongosh` exits non-zero when the script throws, which `spawnCommand`
 * turns into a rejected promise — the `ON_ERROR_STOP=1` equivalent.
 */
export async function runJs(parent: MongoParentOutputs, js: string, ctx: Ctx): Promise<void> {
	// The tool itself is `exec.command` (like sqlite3, unlike the psql/pg_dump
	// split where the parent publishes a wrapper prefix) — mongosh is the only
	// binary this library ever invokes.
	const args = [...parent.exec.args, parent.uri, '--quiet', '--eval', wrapScript(parent.db, js)]
	await spawnCommand(parent.exec.command, args, {
		cwd: parent.exec.cwd ?? ctx.workDir,
		log: ctx.log,
		signal: ctx.signal,
		env: parent.exec.env,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
//  child_process.spawn wrapper
// ─────────────────────────────────────────────────────────────────────────────
//
// Intentionally duplicated from @db-x/postgres-library rather than imported.
// DB-X is meant to stand on its own; the ~40 LOC duplication is the price.

interface SpawnOptions {
	cwd: string
	log: CtxLogger
	signal: AbortSignal
	env?: Record<string, string | undefined>
}

async function spawnCommand(command: string, args: string[], opts: SpawnOptions): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (opts.signal.aborted) {
			reject(new Error(`${command} ${args.join(' ')}: aborted before start`))
			return
		}
		opts.log.debug?.(`$ ${command} ${redact(args).join(' ')}`)
		const child = spawn(command, args, {
			cwd: opts.cwd,
			env: opts.env ? { ...process.env, ...opts.env } : process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let stderr = ''
		child.stdout?.setEncoding('utf8')
		child.stderr?.setEncoding('utf8')
		child.stdout?.on('data', (chunk: string) => {
			for (const line of chunk.split('\n')) {
				if (line.trim() !== '') opts.log.info(line)
			}
		})
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk
			for (const line of chunk.split('\n')) {
				if (line.trim() !== '') opts.log.info(line)
			}
		})
		const onAbort = (): void => {
			child.kill('SIGINT')
		}
		opts.signal.addEventListener('abort', onAbort, { once: true })
		child.on('error', (err) => {
			opts.signal.removeEventListener('abort', onAbort)
			reject(new Error(`${command}: ${err.message}`))
		})
		child.on('close', (code, sig) => {
			opts.signal.removeEventListener('abort', onAbort)
			if (sig) {
				reject(new Error(`${command} ${redact(args).join(' ')}: terminated by signal ${sig}`))
				return
			}
			if (code !== 0) {
				const tail = stderr.trim().split('\n').slice(-5).join('\n')
				reject(new Error(`${command} ${redact(args).join(' ')} failed (exit ${code}):\n${tail}`))
				return
			}
			resolve()
		})
	})
}

/**
 * Mask the password inside any `mongodb://user:pass@…` argument before it
 * reaches a log line or an error message. Unlike psql (`PGPASSWORD`), mongosh
 * has no env-var equivalent — the URI must go in argv, so it is visible in
 * `ps` regardless. This only keeps it out of DB-X's own output.
 */
export function redact(args: string[]): string[] {
	return args.map((a) => a.replace(/^(mongodb(?:\+srv)?:\/\/[^:/@]+):[^@]*@/, '$1:***@'))
}
