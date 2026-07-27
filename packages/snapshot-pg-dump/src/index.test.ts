import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPgDumpDriver, type PgDumpDriverConfig, type SnapshotRunner } from './index.js'

const CONNECTION = {
	exec: { command: 'docker', args: ['compose', 'exec', '-T', 'db'] },
	user: 'app',
	password: 's3cret',
	database: 'appdb',
}

describe('createPgDumpDriver', () => {
	let storeDir: string
	let calls: Array<{ args: string[]; env?: Record<string, string | undefined>; direction: string }>

	// Fake runner: records the invocation and writes a marker artifact for
	// `dump` so list/prune see real files, exactly as the driver expects.
	const run: SnapshotRunner = async (job) => {
		calls.push({ args: job.args, env: job.env, direction: job.direction })
		if (job.direction === 'dump') await fs.writeFile(job.file, '-- dump\n')
	}

	// Deterministic, strictly increasing clock so ids sort predictably.
	const makeClock = (): (() => string) => {
		let n = 0
		return () => `2026-01-01T00:00:0${n++}.000Z`
	}

	const driver = (over?: Partial<PgDumpDriverConfig>) =>
		createPgDumpDriver({ connection: CONNECTION, storeDir, run, now: makeClock(), ...over })

	beforeEach(async () => {
		storeDir = path.join(os.tmpdir(), `dbx-snap-${process.pid}-${calls?.length ?? 0}`)
		calls = []
		await fs.rm(storeDir, { recursive: true, force: true })
	})
	afterEach(async () => {
		await fs.rm(storeDir, { recursive: true, force: true })
	})

	it('captures a schema-only dump pinned to the state revision', async () => {
		const d = driver()
		const ref = await d.create('2025-12-31T23:00:00.000Z')

		expect(ref.stateRev).toBe('2025-12-31T23:00:00.000Z')
		expect(ref.driver).toBe('pg-dump')
		expect(ref.mode).toBe('schema')
		// schema-only flag present, password passed via env not argv
		expect(calls[0]?.args).toEqual([
			'compose',
			'exec',
			'-T',
			'db',
			'pg_dump',
			'-U',
			'app',
			'-d',
			'appdb',
			'--schema-only',
		])
		expect(calls[0]?.env?.PGPASSWORD).toBe('s3cret')
		expect(calls[0]?.args).not.toContain('s3cret')
		await expect(fs.readFile(path.join(storeDir, `${ref.id}.sql`), 'utf-8')).resolves.toContain(
			'-- dump'
		)
	})

	it('full mode omits --schema-only', async () => {
		const ref = await driver({ mode: 'full' }).create('rev')
		expect(ref.mode).toBe('full')
		expect(calls[0]?.args).not.toContain('--schema-only')
	})

	it('lists snapshots newest first', async () => {
		const d = driver()
		await d.create('rev-a')
		await d.create('rev-b')
		const list = await d.list()
		expect(list.map((r) => r.stateRev)).toEqual(['rev-b', 'rev-a'])
	})

	it('prune keeps the N newest and deletes older artifacts', async () => {
		const d = driver()
		const first = await d.create('rev-a')
		await d.create('rev-b')
		await d.create('rev-c')

		const removed = await d.prune({ keepLast: 2 })
		expect(removed.map((r) => r.stateRev)).toEqual(['rev-a'])
		expect((await d.list()).map((r) => r.stateRev)).toEqual(['rev-c', 'rev-b'])
		await expect(fs.access(path.join(storeDir, `${first.id}.sql`))).rejects.toThrow()
	})

	it('restore feeds the artifact back through psql', async () => {
		const d = driver()
		const ref = await d.create('rev-a')
		calls.length = 0
		await d.restore(ref)

		expect(calls[0]?.direction).toBe('restore')
		expect(calls[0]?.args).toEqual([
			'compose',
			'exec',
			'-T',
			'db',
			'psql',
			'-U',
			'app',
			'-d',
			'appdb',
			'-v',
			'ON_ERROR_STOP=1',
		])
	})
})
