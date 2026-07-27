// Internal helpers. Runtime-agnostic SQL execution: the parent runtime
// (a `<Sqlite>` here, or any other component publishing `RuntimeExec`)
// describes how to spawn a command. We append the `sqlite3 ...` invocation
// to it and `child_process.spawn` the result.
//
// This is the only file in the package that touches OS-level concerns.
// Components import only from @db-x/runtime + this module.

import { spawn } from 'node:child_process'
import process from 'node:process'
import type { Ctx, CtxLogger, RuntimeExec } from '@db-x/runtime'

/**
 * Outputs a `<Sqlite>` resource emits — read by child components
 * (`<Table>`, `<SeedData>`, …) via `ctx.deps[parentId]`. Unlike Postgres,
 * SQLite has no separate user/database — the file *is* the database.
 */
export interface SqliteParentOutputs {
	/** Absolute path to the `.db` file, resolved at apply time. */
	file: string
	/** Spawn template forwarded from the runtime parent. */
	exec: RuntimeExec
}

// ─────────────────────────────────────────────────────────────────────────────
//  Parent lookup
// ─────────────────────────────────────────────────────────────────────────────

export function requireSqliteParent(ctx: Ctx, tagName: string): SqliteParentOutputs {
	const parent = findSqliteParent(ctx)
	if (!parent) {
		throw new Error(
			`<${tagName}> must be a (transitive) child of <Sqlite> (from @db-x/sqlite-library). Resource ${ctx.resource.id} has no sqlite parent outputs.`
		)
	}
	return parent
}

export function findSqliteParent(ctx: Ctx): SqliteParentOutputs | null {
	const parentId = ctx.resource.parent
	if (!parentId) return null
	const outputs = ctx.deps[parentId] as Partial<SqliteParentOutputs> | undefined
	if (!outputs?.file || !outputs.exec?.command || !Array.isArray(outputs.exec.args)) return null
	return outputs as SqliteParentOutputs
}

// ─────────────────────────────────────────────────────────────────────────────
//  SQL execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a SQL string against the database file described by `<Sqlite>`
 * outputs. `-bail` stops on the first error (the `ON_ERROR_STOP`
 * equivalent for `psql`).
 */
export async function runSql(parent: SqliteParentOutputs, sql: string, ctx: Ctx): Promise<void> {
	const sqliteArgs = ['-bail', parent.file, sql]
	await spawnCommand(parent.exec.command, [...parent.exec.args, ...sqliteArgs], {
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
