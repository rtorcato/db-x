import type { Plan, PlanAction, ResourceState, SnapshotRef, StateFile } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import { planHasDestructive, resolveSnapshotTarget, selectSnapshotId } from './snapshot.js'

const diff = (id: string, action: PlanAction) => ({
	id,
	kind: 'x',
	action,
	desired: null,
	current: null,
})
const planOf = (...actions: PlanAction[]): Plan => ({
	actions: actions.map((a, i) => diff(`r${i}`, a)),
})

describe('planHasDestructive', () => {
	it('is false for creates / no-ops / non-destructive updates', () => {
		expect(planHasDestructive(planOf({ type: 'create' }, { type: 'no-op' }))).toBe(false)
		expect(planHasDestructive(planOf({ type: 'update', reason: 'props changed' }))).toBe(false)
		expect(planHasDestructive(planOf({ type: 'update', reason: 'r', destructive: [] }))).toBe(false)
	})

	it('is true when any action carries a non-empty destructive list', () => {
		expect(
			planHasDestructive(
				planOf({ type: 'create' }, { type: 'update', reason: 'r', destructive: ['DROP INDEX "x"'] })
			)
		).toBe(true)
		expect(
			planHasDestructive(planOf({ type: 'destroy', reason: 'r', destructive: ['destroy x'] }))
		).toBe(true)
	})
})

describe('resolveSnapshotTarget', () => {
	const res = (id: string, outputs: object): ResourceState => ({
		id,
		kind: `test:${id}`,
		props: {},
		outputs,
		dependsOn: [],
		lastApplied: '2026-07-27T00:00:00.000Z',
	})
	const stateOf = (...records: ResourceState[]): StateFile => ({
		version: 1,
		resources: Object.fromEntries(records.map((r) => [r.id, r])),
	})

	const exec = { command: 'env', args: [], env: { PGHOST: 'db' } }
	const pgOutputs = { user: 'app', password: 's3cret', database: 'appdb', exec }
	const taggedPg = { ...pgOutputs, snapshotDriver: 'pg-dump' }
	const taggedMongo = {
		database: 'todos',
		uri: 'mongodb://u:p@localhost:27017/',
		exec: { command: 'env', args: [] },
		snapshotDriver: 'mongodump',
	}

	it('picks the driver from the snapshotDriver tag', () => {
		expect(resolveSnapshotTarget(stateOf(res('db', taggedPg)))?.driver).toBe('pg-dump')
		expect(resolveSnapshotTarget(stateOf(res('db', taggedMongo)))?.driver).toBe('mongodump')
	})

	it('never resolves a tagged Mongo connection to pg-dump', () => {
		// The bug this replaces: duck-typing would have matched anything with
		// {user, password, database, exec} and shelled out to pg_dump.
		const target = resolveSnapshotTarget(
			stateOf(res('mongo', { ...taggedMongo, user: 'u', password: 'p' }))
		)
		expect(target?.driver).toBe('mongodump')
	})

	it('prefers a tagged resource over an untagged Postgres-shaped one', () => {
		const target = resolveSnapshotTarget(stateOf(res('legacy', pgOutputs), res('m', taggedMongo)))
		expect(target?.driver).toBe('mongodump')
	})

	it('falls back to the legacy Postgres shape when nothing is tagged', () => {
		const target = resolveSnapshotTarget(stateOf(res('db', pgOutputs)))
		expect(target?.driver).toBe('pg-dump')
		expect(target?.outputs.database).toBe('appdb')
	})

	it('skips resources missing connection fields, returns the first full match', () => {
		const target = resolveSnapshotTarget(
			stateOf(res('table', { columns: [] }), res('db', pgOutputs))
		)
		expect(target?.outputs.database).toBe('appdb')
	})

	it('ignores an unknown driver tag rather than trusting it', () => {
		const target = resolveSnapshotTarget(
			stateOf(res('weird', { database: 'd', exec, snapshotDriver: 'rsync-and-pray' }))
		)
		expect(target).toBeNull()
	})

	it('ignores a tagged resource with no usable exec template', () => {
		expect(
			resolveSnapshotTarget(
				stateOf(res('m', { database: 'd', uri: 'x', snapshotDriver: 'mongodump' }))
			)
		).toBeNull()
	})

	it('returns null when no resource carries a full connection', () => {
		expect(resolveSnapshotTarget(stateOf(res('table', { columns: [] })))).toBeNull()
		// exec present but no creds
		expect(resolveSnapshotTarget(stateOf(res('half', { exec })))).toBeNull()
	})

	it('labels a Postgres target with user, a Mongo target with the database', () => {
		expect(resolveSnapshotTarget(stateOf(res('db', taggedPg)))?.label).toBe('appdb as app')
		expect(resolveSnapshotTarget(stateOf(res('m', taggedMongo)))?.label).toBe('todos')
	})
})

describe('selectSnapshotId', () => {
	const ref = (id: string): SnapshotRef => ({
		id,
		stateRev: 'r',
		createdAt: '2026-07-28T00:00:00.000Z',
		driver: 'pg-dump',
		mode: 'schema',
	})
	// list() returns newest first, so [0] is the newest.
	const store = [ref('snap-new'), ref('snap-old')]

	it('prefers an explicit id over everything', () => {
		expect(selectSnapshotId('snap-x', 'snap-pinned', store)).toBe('snap-x')
	})

	it('falls back to the pinned id when none is explicit', () => {
		expect(selectSnapshotId(undefined, 'snap-pinned', store)).toBe('snap-pinned')
	})

	it('falls back to the newest in the store when nothing explicit or pinned', () => {
		expect(selectSnapshotId(undefined, undefined, store)).toBe('snap-new')
	})

	it('returns null only when there is no explicit/pinned id and the store is empty', () => {
		expect(selectSnapshotId(undefined, undefined, [])).toBeNull()
	})

	it('returns a pinned id even if the store is empty (caller reports it missing)', () => {
		expect(selectSnapshotId(undefined, 'snap-pruned', [])).toBe('snap-pruned')
	})
})
