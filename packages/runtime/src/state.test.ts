import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	STATE_SCHEMA_VERSION,
	type StateFile,
	acquireLock,
	emptyState,
	readState,
	withLock,
	writeState,
} from './state.js'

describe('state', () => {
	let workDir: string

	beforeEach(async () => {
		workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dbx-state-'))
	})

	afterEach(async () => {
		await fs.rm(workDir, { recursive: true, force: true })
	})

	describe('readState', () => {
		it('returns empty state when no file exists', async () => {
			const state = await readState(workDir)
			expect(state).toEqual({ version: STATE_SCHEMA_VERSION, resources: {} })
		})

		it('reads back persisted state', async () => {
			const original: StateFile = {
				version: STATE_SCHEMA_VERSION,
				resources: {
					'foo:x': {
						id: 'foo:x',
						kind: 'test:foo',
						props: { name: 'x' },
						outputs: { id: '1' },
						dependsOn: [],
						lastApplied: '2026-05-20T00:00:00Z',
					},
				},
			}
			await writeState(workDir, original)
			const round = await readState(workDir)
			expect(round.resources['foo:x']?.kind).toBe('test:foo')
			expect(round.resources['foo:x']?.outputs).toEqual({ id: '1' })
		})

		it('rejects mismatched schema version', async () => {
			await fs.mkdir(path.join(workDir, '.dbx'), { recursive: true })
			await fs.writeFile(
				path.join(workDir, '.dbx', 'state.json'),
				JSON.stringify({ version: 999, resources: {} })
			)
			await expect(readState(workDir)).rejects.toThrow(/Unsupported state schema version/)
		})

		it('rejects malformed state without resources', async () => {
			await fs.mkdir(path.join(workDir, '.dbx'), { recursive: true })
			await fs.writeFile(
				path.join(workDir, '.dbx', 'state.json'),
				JSON.stringify({ version: STATE_SCHEMA_VERSION })
			)
			await expect(readState(workDir)).rejects.toThrow(/'resources' object/)
		})

		it('rejects non-JSON files', async () => {
			await fs.mkdir(path.join(workDir, '.dbx'), { recursive: true })
			await fs.writeFile(path.join(workDir, '.dbx', 'state.json'), 'not json')
			await expect(readState(workDir)).rejects.toThrow(/not valid JSON/)
		})
	})

	describe('writeState', () => {
		it('creates the .dbx directory if missing', async () => {
			await writeState(workDir, emptyState())
			const stat = await fs.stat(path.join(workDir, '.dbx', 'state.json'))
			expect(stat.isFile()).toBe(true)
		})

		it('always stamps lastApplied on write', async () => {
			await writeState(workDir, emptyState())
			const state = await readState(workDir)
			expect(state.lastApplied).toBeDefined()
			expect(new Date(state.lastApplied as string).toString()).not.toBe('Invalid Date')
		})

		it('round-trips resources verbatim', async () => {
			const original: StateFile = {
				version: STATE_SCHEMA_VERSION,
				resources: {
					'foo:a': {
						id: 'foo:a',
						kind: 'test:foo',
						props: { name: 'a', count: 3 },
						outputs: { url: 'https://...' },
						dependsOn: ['bar:b'],
						phase: 'setup',
						lastApplied: '2026-05-20T00:00:00Z',
					},
				},
			}
			await writeState(workDir, original)
			const round = await readState(workDir)
			expect(round.resources).toEqual(original.resources)
		})

		it('does not leave a tmp file behind on success', async () => {
			await writeState(workDir, emptyState())
			const entries = await fs.readdir(path.join(workDir, '.dbx'))
			const tmps = entries.filter((e) => e.endsWith('.tmp'))
			expect(tmps).toEqual([])
		})
	})

	describe('acquireLock', () => {
		it('writes a lock file containing the holder identity', async () => {
			const lock = await acquireLock(workDir)
			const content = await fs.readFile(lock.path, 'utf-8')
			expect(content).toContain(String(process.pid))
			await lock.release()
		})

		it('throws when the lock is already held', async () => {
			const first = await acquireLock(workDir)
			await expect(acquireLock(workDir)).rejects.toThrow(/State is locked/)
			await first.release()
		})

		it('allows re-acquiring after release', async () => {
			const first = await acquireLock(workDir)
			await first.release()
			const second = await acquireLock(workDir)
			await second.release()
		})

		it('release is idempotent on already-removed lock', async () => {
			const lock = await acquireLock(workDir)
			await lock.release()
			await expect(lock.release()).resolves.toBeUndefined()
		})
	})

	describe('withLock', () => {
		it('runs fn within a lock and releases on success', async () => {
			const result = await withLock(workDir, async () => 42)
			expect(result).toBe(42)
			const second = await acquireLock(workDir)
			await second.release()
		})

		it('releases the lock even when fn throws', async () => {
			await expect(
				withLock(workDir, async () => {
					throw new Error('boom')
				})
			).rejects.toThrow('boom')
			const second = await acquireLock(workDir)
			await second.release()
		})
	})
})
