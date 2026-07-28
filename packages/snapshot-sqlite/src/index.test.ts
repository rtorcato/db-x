import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	createSqliteDriver,
	dotCommand,
	type SnapshotRunner,
	type SqliteDriverConfig,
} from './index.js'

describe('createSqliteDriver', () => {
	let storeDir: string
	let dbFile: string
	let calls: Array<{ args: string[] }>

	// Fake runner: records the invocation and writes a marker artifact for
	// `.backup` so list/prune/restore see real files, as the driver expects.
	const run: SnapshotRunner = async (job) => {
		calls.push({ args: job.args })
		const backup = job.args.find((a) => a.startsWith('.backup '))
		if (backup) await fs.writeFile(unquote(backup), 'sqlite-bytes')
	}

	const makeClock = (): (() => string) => {
		let n = 0
		return () => `2026-01-01T00:00:0${n++}.000Z`
	}

	const driver = (over?: Partial<SqliteDriverConfig>) =>
		createSqliteDriver({
			connection: { exec: { command: 'sqlite3', args: [] }, file: dbFile },
			storeDir,
			run,
			now: makeClock(),
			...over,
		})

	beforeEach(async () => {
		storeDir = path.join(os.tmpdir(), `dbx-sqlitesnap-${process.pid}-${calls?.length ?? 0}`)
		dbFile = path.join(storeDir, 'todos.db')
		calls = []
		await fs.rm(storeDir, { recursive: true, force: true })
	})
	afterEach(async () => {
		await fs.rm(storeDir, { recursive: true, force: true })
	})

	it('captures via .backup, pinned to the state revision', async () => {
		const ref = await driver().create('2025-12-31T23:00:00.000Z')

		expect(ref.stateRev).toBe('2025-12-31T23:00:00.000Z')
		expect(ref.driver).toBe('sqlite-backup')
		expect(ref.mode).toBe('full')
		expect(calls[0]?.args).toEqual([dbFile, `.backup '${path.join(storeDir, `${ref.id}.db`)}'`])
	})

	it("rejects mode 'schema' — a database file always carries its rows", () => {
		expect(() => driver({ mode: 'schema' })).toThrow(/not supported/)
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
		await expect(fs.access(path.join(storeDir, `${first.id}.db`))).rejects.toThrow()
	})

	it('restore feeds the artifact back through .restore', async () => {
		const d = driver()
		const ref = await d.create('rev-a')
		calls.length = 0
		await d.restore(ref)

		expect(calls[0]?.args).toEqual([dbFile, `.restore '${path.join(storeDir, `${ref.id}.db`)}'`])
	})

	// Verified against sqlite 3.x: `.restore <missing>` exits 0, prints nothing,
	// and leaves the target database EMPTY. Without this guard, restoring a
	// pruned snapshot would destroy the data the user was trying to recover.
	it('refuses to restore when the artifact is missing, instead of emptying the database', async () => {
		const d = driver()
		const ref = await d.create('rev-a')
		await fs.rm(path.join(storeDir, `${ref.id}.db`))
		calls.length = 0

		await expect(d.restore(ref)).rejects.toThrow(/missing.*empty database/s)
		expect(calls).toHaveLength(0)
	})
})

describe('dotCommand', () => {
	it('quotes the path so spaces survive sqlite3 argument splitting', () => {
		expect(dotCommand('.backup', '/tmp/my db/snap.db')).toBe(".backup '/tmp/my db/snap.db'")
	})

	it('doubles an embedded single quote rather than ending the quoted string', () => {
		expect(dotCommand('.restore', "/tmp/o'brien.db")).toBe(".restore '/tmp/o''brien.db'")
	})
})

/** Pull the path back out of a `.backup '<path>'` dot-command. */
function unquote(dot: string): string {
	return dot.slice(dot.indexOf("'") + 1, dot.lastIndexOf("'")).replace(/''/g, "'")
}
