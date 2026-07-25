// State I/O — read/write `.dbx/state.json` and an exclusive `.dbx/state.lock`.
//
// v0.1 stores state locally in the project's working directory. The state
// file is intentionally human-readable JSON; users may inspect or hand-edit
// it for debugging. The lock prevents concurrent runs from racing on it.
//
// Remote state backends (S3, git, HTTP) come later via a `StateBackend`
// interface. The shape here is the local default backend.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ResourceState } from './types.js'

export const STATE_SCHEMA_VERSION = 1
export const STATE_DIR = '.dbx'
export const STATE_FILE = 'state.json'
export const LOCK_FILE = 'state.lock'

export interface StateFile {
	version: number
	lastApplied?: string
	resources: Record<string, ResourceState>
}

export function emptyState(): StateFile {
	return { version: STATE_SCHEMA_VERSION, resources: {} }
}

function paths(workDir: string): { dir: string; state: string; lock: string } {
	const dir = path.join(workDir, STATE_DIR)
	return {
		dir,
		state: path.join(dir, STATE_FILE),
		lock: path.join(dir, LOCK_FILE),
	}
}

export async function readState(workDir: string): Promise<StateFile> {
	const { state } = paths(workDir)
	let content: string
	try {
		content = await fs.readFile(state, 'utf-8')
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyState()
		throw err
	}

	let parsed: Partial<StateFile>
	try {
		parsed = JSON.parse(content) as Partial<StateFile>
	} catch (err) {
		throw new Error(`State file at ${state} is not valid JSON: ${(err as Error).message}`)
	}

	if (parsed.version !== STATE_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported state schema version ${parsed.version}. Expected ${STATE_SCHEMA_VERSION}. Migration tooling is not available in v0.1 — recreate the state file or downgrade.`
		)
	}
	if (!parsed.resources || typeof parsed.resources !== 'object') {
		throw new Error(`State file at ${state} is missing a 'resources' object`)
	}

	return parsed as StateFile
}

export async function writeState(workDir: string, state: StateFile): Promise<void> {
	const { dir, state: filePath } = paths(workDir)
	await fs.mkdir(dir, { recursive: true })
	const updated: StateFile = { ...state, lastApplied: new Date().toISOString() }
	// Write to a temp file first then rename — avoids leaving a half-written
	// state.json on crash mid-write.
	const tmpPath = path.join(dir, `state.json.${process.pid}.${Date.now()}.tmp`)
	await fs.writeFile(tmpPath, `${JSON.stringify(updated, null, 2)}\n`)
	await fs.rename(tmpPath, filePath)
}

export interface LockHandle {
	/** Absolute path of the lock file. */
	path: string
	/** Idempotent — safe to call multiple times. */
	release: () => Promise<void>
}

export async function acquireLock(workDir: string): Promise<LockHandle> {
	const { dir, lock } = paths(workDir)
	await fs.mkdir(dir, { recursive: true })
	const payload = JSON.stringify({
		pid: process.pid,
		host: os.hostname(),
		at: new Date().toISOString(),
	})
	try {
		await fs.writeFile(lock, payload, { flag: 'wx' })
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
			let holder = 'unknown holder'
			try {
				holder = (await fs.readFile(lock, 'utf-8')).trim() || 'empty lock file'
			} catch {
				// ignore — fall through with generic message
			}
			throw new Error(
				`State is locked by ${holder}. If that process is dead, delete ${lock} manually.`
			)
		}
		throw err
	}
	return {
		path: lock,
		release: async () => {
			try {
				await fs.unlink(lock)
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
			}
		},
	}
}

/** Run `fn` while holding the state lock. Releases on success or error. */
export async function withLock<T>(workDir: string, fn: () => Promise<T>): Promise<T> {
	const lock = await acquireLock(workDir)
	try {
		return await fn()
	} finally {
		await lock.release()
	}
}
