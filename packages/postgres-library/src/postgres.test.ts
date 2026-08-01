import { getComponentSpec } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
// Importing for the side effect: `defineComponent` registers the kind on module
// load, and these tests dispatch through the registry the way the executor does.
import './postgres.js'

describe('Postgres.apply — server probe decides the snapshot tag', () => {
	const spec = getComponentSpec('@db-x/postgres-library:postgres')
	if (!spec?.apply) throw new Error('postgres component is not registered with an apply hook')
	const applyHook = spec.apply as (
		p: object,
		c: object,
		s: object | null
	) => Promise<Record<string, unknown>>

	/** `sh -c` stands in for psql and prints whatever `select version()` should say. */
	const ctxReporting = (version: string) => ({
		resource: { id: 'postgres:db', parent: 'target#0' },
		deps: {
			'target#0': {
				user: 'u',
				password: 'p',
				database: 'app',
				exec: {
					command: 'sh',
					args: ['-c', 'printf %s "$DBX_OUT"'],
					env: { DBX_OUT: JSON.stringify([{ version }]) },
				},
			},
		},
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		workDir: '/tmp',
		signal: new AbortController().signal,
	})

	it('tags a real Postgres server pg-dump', async () => {
		const outputs = await applyHook({}, ctxReporting('PostgreSQL 17.10 on aarch64'), null)
		expect(outputs.serverKind).toBe('postgres')
		expect(outputs.snapshotDriver).toBe('pg-dump')
		expect(outputs.snapshotUnsupported).toBeUndefined()
	})

	// pg_dump fails against CockroachDB ("schema with OID … does not exist"), so
	// claiming pg-dump would let a destructive apply run behind an archive that
	// cannot restore — the one failure mode a safety net must not have.
	it('refuses to claim a snapshot driver for CockroachDB', async () => {
		const outputs = await applyHook({}, ctxReporting('CockroachDB CCL v26.2.4 (aarch64)'), null)
		expect(outputs.serverKind).toBe('cockroachdb')
		expect(outputs.snapshotDriver).toBeUndefined()
		expect(outputs.snapshotUnsupported).toBe('cockroachdb')
	})

	// An unreachable server is not evidence of anything; assume what this
	// component assumed before the probe existed rather than failing here.
	it('assumes postgres when the probe cannot run', async () => {
		const ctx = ctxReporting('')
		ctx.deps['target#0'].exec = { command: 'false', args: [], env: {} }
		const outputs = await applyHook({}, ctx, null)
		expect(outputs.serverKind).toBe('postgres')
		expect(outputs.snapshotDriver).toBe('pg-dump')
	})
})

describe('Postgres.plan — one-off re-apply to fill in the server kind', () => {
	const spec = getComponentSpec('@db-x/postgres-library:postgres')
	if (!spec?.plan) throw new Error('postgres component has no plan hook')
	const planHook = spec.plan as (p: object, s: object | null) => { type: string; reason?: string }

	// Without this, state written before the probe keeps `snapshotDriver:
	// 'pg-dump'` forever: `<Postgres>` plans no-op, so it never re-applies, so
	// the stale tag outlives the fix on exactly the databases it was added for.
	it('plans an update when state predates the probe', () => {
		const action = planHook({ name: 'db' }, { props: { name: 'db' }, outputs: {} })
		expect(action.type).toBe('update')
		expect(action.reason).toMatch(/server kind/)
	})

	it('goes back to no-op once the server kind is recorded', () => {
		const action = planHook(
			{ name: 'db' },
			{ props: { name: 'db' }, outputs: { serverKind: 'postgres' } }
		)
		expect(action.type).toBe('no-op')
	})
})
