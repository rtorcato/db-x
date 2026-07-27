import type { Plan, PlanAction, ResourceState, StateFile } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
import { planHasDestructive, resolveSnapshotConnection } from './snapshot.js'

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

describe('resolveSnapshotConnection', () => {
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

	const pgOutputs = {
		user: 'app',
		password: 's3cret',
		database: 'appdb',
		exec: { command: 'env', args: [], env: { PGHOST: 'db' } },
	}

	it('duck-types a Postgres-shaped resource into a connection', () => {
		const conn = resolveSnapshotConnection(stateOf(res('db', pgOutputs)))
		expect(conn).toEqual({
			user: 'app',
			password: 's3cret',
			database: 'appdb',
			exec: { command: 'env', args: [], env: { PGHOST: 'db' } },
		})
	})

	it('skips resources missing connection fields, returns the first full match', () => {
		const conn = resolveSnapshotConnection(
			stateOf(res('table', { columns: [] }), res('db', pgOutputs))
		)
		expect(conn?.database).toBe('appdb')
	})

	it('returns null when no resource carries a full connection', () => {
		expect(resolveSnapshotConnection(stateOf(res('table', { columns: [] })))).toBeNull()
		// exec present but no creds
		expect(
			resolveSnapshotConnection(stateOf(res('half', { exec: { command: 'env', args: [] } })))
		).toBeNull()
	})
})
