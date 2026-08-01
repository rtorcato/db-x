// Internal helpers. Runtime-agnostic SQL execution: the parent runtime
// (a `<DatabaseTarget>` here, or any other component publishing
// `RuntimeExec`) describes how to spawn a command. We prepend
// `psql ...` to it and `child_process.spawn` the result.
//
// This is the only file in the package that touches OS-level concerns.
// Components import only from @db-x/runtime + this module.

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Ctx, CtxLogger, RuntimeExec } from '@db-x/runtime'

/**
 * Outputs a `<Postgres>` resource emits — read by child components
 * (`<Extension>`, `<Table>`, …) via `ctx.deps[parentId]`.
 */
export interface PostgresParentOutputs {
	user: string
	password: string
	database: string
	/** Spawn template forwarded from the runtime parent (DatabaseTarget, Service, etc.). */
	exec: RuntimeExec
	/**
	 * Which `SnapshotDriver` can capture this database (#78). The CLI reads the
	 * tag rather than duck-typing the connection record. Optional so state
	 * written before the tag existed still resolves — the CLI falls back to the
	 * legacy shape match.
	 */
	snapshotDriver?: 'pg-dump'
	/** What that driver captures — from `<Postgres snapshot>`. Defaults to `schema`. */
	snapshotMode?: 'schema' | 'full'
}

/**
 * Subset of outputs `<Postgres>` itself looks for on *its* parent — a
 * component that publishes a psql-capable spawn template.
 */
export interface RuntimeParentOutputs {
	exec: RuntimeExec
	/** Optional connection defaults a target can advertise; `<Postgres>` props win. */
	user?: string
	password?: string
	database?: string
}

// ─────────────────────────────────────────────────────────────────────────────
//  Parent lookup
// ─────────────────────────────────────────────────────────────────────────────

export function requireRuntimeParent(ctx: Ctx, tagName: string): RuntimeParentOutputs {
	const parent = findRuntimeParent(ctx)
	if (!parent) {
		throw new Error(
			`<${tagName}> must be a (transitive) child of a component that publishes an \`exec\` record (e.g. <DatabaseTarget> from @db-x/postgres-library). Resource ${ctx.resource.id} has no such parent.`
		)
	}
	return parent
}

function findRuntimeParent(ctx: Ctx): RuntimeParentOutputs | null {
	const parentId = ctx.resource.parent
	if (!parentId) return null
	const outputs = ctx.deps[parentId] as Partial<RuntimeParentOutputs> | undefined
	if (!outputs?.exec?.command || !Array.isArray(outputs.exec.args)) return null
	return outputs as RuntimeParentOutputs
}

export function requirePostgresParent(ctx: Ctx, tagName: string): PostgresParentOutputs {
	const parent = findPostgresParent(ctx)
	if (!parent) {
		throw new Error(
			`<${tagName}> must be a (transitive) child of <Postgres>. Resource ${ctx.resource.id} has no postgres parent outputs.`
		)
	}
	return parent
}

export function findPostgresParent(ctx: Ctx): PostgresParentOutputs | null {
	const parentId = ctx.resource.parent
	if (!parentId) return null
	const outputs = ctx.deps[parentId] as Partial<PostgresParentOutputs> | undefined
	if (
		!outputs ||
		!outputs.user ||
		!outputs.password ||
		!outputs.database ||
		!outputs.exec?.command ||
		!Array.isArray(outputs.exec.args)
	) {
		return null
	}
	return outputs as PostgresParentOutputs
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQL execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a SQL string against the database described by `<Postgres>` outputs.
 * The parent's `exec` record describes how to reach a psql-capable shell —
 * could be `docker compose exec`, `ssh user@host`, or a direct env-vars
 * setup published by `<DatabaseTarget>`.
 */
export async function runSql(
	parent: PostgresParentOutputs,
	user: string,
	database: string,
	sql: string,
	ctx: Ctx
): Promise<void> {
	const psqlArgs = ['psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql]
	await spawnCommand(parent.exec.command, [...parent.exec.args, ...psqlArgs], {
		cwd: parent.exec.cwd ?? ctx.workDir,
		log: ctx.log,
		signal: ctx.signal,
		env: parent.exec.env,
	})
}

/**
 * Run a read-only query and parse its rows. Used by `refresh` hooks, which
 * must observe the database without changing it.
 *
 * Postgres builds the JSON itself — `json_agg` over the sub-select, printed by
 * `-At` (unaligned, tuples-only) as a single line. That beats parsing psql's
 * column output, where any value containing the delimiter would corrupt the
 * split. `coalesce` keeps a no-rows result a valid `[]` rather than a blank.
 */
export async function queryJson(
	parent: PostgresParentOutputs,
	user: string,
	database: string,
	sql: string,
	ctx: Ctx
): Promise<Array<Record<string, unknown>>> {
	const wrapped = `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (${sql}) t`
	const psqlArgs = [
		'psql',
		'-U',
		user,
		'-d',
		database,
		'-At',
		'-v',
		'ON_ERROR_STOP=1',
		'-c',
		wrapped,
	]
	const out = await captureCommand(parent.exec.command, [...parent.exec.args, ...psqlArgs], {
		cwd: parent.exec.cwd ?? ctx.workDir,
		log: ctx.log,
		signal: ctx.signal,
		env: parent.exec.env,
	})
	const trimmed = out.trim()
	if (trimmed === '') return []
	return JSON.parse(trimmed) as Array<Record<string, unknown>>
}

/**
 * Escape a value for interpolation into a SQL string literal. Table names
 * reach the introspection queries as literals, not identifiers, so they need
 * `'` doubling rather than `"` quoting.
 */
export function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`
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
		opts.log.debug?.(`$ ${command} ${args.join(' ')}`)
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
}

/**
 * Like `spawnCommand`, but resolves with the child's stdout instead of
 * streaming it to the log — the caller wants the bytes, not a transcript.
 */
async function captureCommand(
	command: string,
	args: string[],
	opts: SpawnOptions
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		if (opts.signal.aborted) {
			reject(new Error(`${command} ${args.join(' ')}: aborted before start`))
			return
		}
		opts.log.debug?.(`$ ${command} ${args.join(' ')}`)
		const child = spawn(command, args, {
			cwd: opts.cwd,
			env: opts.env ? { ...process.env, ...opts.env } : process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let stdout = ''
		let stderr = ''
		child.stdout?.setEncoding('utf8')
		child.stderr?.setEncoding('utf8')
		child.stdout?.on('data', (chunk: string) => {
			stdout += chunk
		})
		child.stderr?.on('data', (chunk: string) => {
			stderr += chunk
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
				reject(new Error(`${command} ${args.join(' ')}: terminated by signal ${sig}`))
				return
			}
			if (code !== 0) {
				const tail = stderr.trim().split('\n').slice(-5).join('\n')
				reject(new Error(`${command} ${args.join(' ')} failed (exit ${code}):\n${tail}`))
				return
			}
			resolve(stdout)
		})
	})
}
