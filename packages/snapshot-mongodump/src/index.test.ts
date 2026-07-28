import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	createMongodumpDriver,
	type MongodumpDriverConfig,
	redact,
	type SnapshotRunner,
} from './index.js'

const CONNECTION = {
	exec: { command: 'docker', args: ['compose', 'exec', '-T', 'mongodb'] },
	uri: 'mongodb://todos:s3cret@localhost:27017/?authSource=admin',
	database: 'todos',
}

describe('createMongodumpDriver', () => {
	let storeDir: string
	let calls: Array<{ args: string[]; env?: Record<string, string | undefined>; direction: string }>

	// Fake runner: records the invocation and writes a marker artifact for
	// `dump` so list/prune see real files, exactly as the driver expects.
	const run: SnapshotRunner = async (job) => {
		calls.push({ args: job.args, env: job.env, direction: job.direction })
		if (job.direction === 'dump') await fs.writeFile(job.file, 'archive-bytes')
	}

	// Deterministic, strictly increasing clock so ids sort predictably.
	const makeClock = (): (() => string) => {
		let n = 0
		return () => `2026-01-01T00:00:0${n++}.000Z`
	}

	const driver = (over?: Partial<MongodumpDriverConfig>) =>
		createMongodumpDriver({ connection: CONNECTION, storeDir, run, now: makeClock(), ...over })

	beforeEach(async () => {
		storeDir = path.join(os.tmpdir(), `dbx-mongosnap-${process.pid}-${calls?.length ?? 0}`)
		calls = []
		await fs.rm(storeDir, { recursive: true, force: true })
	})
	afterEach(async () => {
		await fs.rm(storeDir, { recursive: true, force: true })
	})

	it('captures a gzipped archive pinned to the state revision', async () => {
		const ref = await driver().create('2025-12-31T23:00:00.000Z')

		expect(ref.stateRev).toBe('2025-12-31T23:00:00.000Z')
		expect(ref.driver).toBe('mongodump')
		expect(ref.mode).toBe('full')
		expect(calls[0]?.args).toEqual([
			'compose',
			'exec',
			'-T',
			'mongodb',
			'mongodump',
			`--uri=${CONNECTION.uri}`,
			'--db=todos',
			'--archive',
			'--gzip',
			'--quiet',
		])
		await expect(
			fs.readFile(path.join(storeDir, `${ref.id}.archive.gz`), 'utf-8')
		).resolves.toContain('archive-bytes')
	})

	it("rejects mode 'schema' rather than silently capturing data", () => {
		expect(() => driver({ mode: 'schema' })).toThrow(/not supported/)
	})

	it('records mode full even when asked for full explicitly', async () => {
		expect((await driver({ mode: 'full' }).create('rev')).mode).toBe('full')
	})

	it('lists snapshots newest first', async () => {
		const d = driver()
		await d.create('rev-a')
		await d.create('rev-b')
		expect((await d.list()).map((r) => r.stateRev)).toEqual(['rev-b', 'rev-a'])
	})

	it('prune keeps the N newest and deletes older artifacts', async () => {
		const d = driver()
		const first = await d.create('rev-a')
		await d.create('rev-b')
		await d.create('rev-c')

		const removed = await d.prune({ keepLast: 2 })
		expect(removed.map((r) => r.stateRev)).toEqual(['rev-a'])
		expect((await d.list()).map((r) => r.stateRev)).toEqual(['rev-c', 'rev-b'])
		await expect(fs.access(path.join(storeDir, `${first.id}.archive.gz`))).rejects.toThrow()
	})

	it('restore feeds the archive back through mongorestore, scoped to the database', async () => {
		const d = driver()
		const ref = await d.create('rev-a')
		calls.length = 0
		await d.restore(ref)

		expect(calls[0]?.direction).toBe('restore')
		expect(calls[0]?.args).toEqual([
			'compose',
			'exec',
			'-T',
			'mongodb',
			'mongorestore',
			`--uri=${CONNECTION.uri}`,
			'--archive',
			'--gzip',
			'--drop',
			'--nsInclude=todos.*',
			'--quiet',
		])
	})
})

describe('redact', () => {
	it('masks the password inside a --uri argument', () => {
		expect(redact([`--uri=${CONNECTION.uri}`])).toEqual([
			'--uri=mongodb://todos:***@localhost:27017/?authSource=admin',
		])
	})

	it('masks an SRV URI too', () => {
		expect(redact(['--uri=mongodb+srv://u:p@cluster.example.net/db'])).toEqual([
			'--uri=mongodb+srv://u:***@cluster.example.net/db',
		])
	})

	it('leaves credential-free arguments alone', () => {
		expect(redact(['--gzip', '--uri=mongodb://localhost:27017'])).toEqual([
			'--gzip',
			'--uri=mongodb://localhost:27017',
		])
	})
})
