import { type Ctx, getComponentSpec } from '@db-x/runtime'
import { describe, expect, it } from 'vitest'
// Import for its registration side effect — defineComponent registers the spec
// by kind on module load, and we drive that registered apply() directly.
import { DatabaseTarget } from './target.js'

const KIND = '@db-x/postgres-library:database-target'

// Minimal Ctx — apply() only touches ctx.log.info.
const CTX = { log: { info() {}, warn() {}, error() {}, debug() {} } } as unknown as Ctx

const applyTarget = (url: string) => {
	const spec = getComponentSpec(KIND)
	if (!spec?.apply) throw new Error(`${KIND} not registered`)
	return spec.apply({ url }, CTX) as Promise<{
		exec: { command: string; args: string[]; env?: Record<string, string | undefined> }
		host: string
		port: number
		user: string
		password: string
		database: string
	}>
}

describe('<DatabaseTarget> exec (#26)', () => {
	// Keep the import referenced so it isn't tree-shaken away, which would drop
	// the registration this whole suite depends on.
	it('is registered', () => {
		expect(DatabaseTarget.__dbx.kind).toBe(KIND)
	})

	it('publishes a pass-through wrapper, not the tool itself', async () => {
		const { exec } = await applyTarget('postgres://u:p@db.example:5432/appdb')
		// `env` runs whatever tool the child appends; using 'psql' here would
		// hardcode the tool and break pg_dump / any other client.
		expect(exec.command).toBe('env')
		expect(exec.args).toEqual([])
	})

	it('lets a child append its tool as argv[0] after the wrapper', async () => {
		const { exec } = await applyTarget('postgres://u:p@db.example:5432/appdb')
		// This is exactly how runSql / the pg-dump driver build the argv.
		const psqlArgv = [...exec.args, 'psql', '-U', 'u', '-d', 'appdb']
		const dumpArgv = [...exec.args, 'pg_dump', '-U', 'u', '-d', 'appdb', '--schema-only']
		expect(psqlArgv[0]).toBe('psql')
		expect(dumpArgv[0]).toBe('pg_dump')
		// Regression guard: the old `command:'psql'` would have run
		// `spawn('psql', ['pg_dump', …])` — psql, never pg_dump.
		expect(exec.command).not.toBe('psql')
		expect(exec.command).not.toBe('pg_dump')
	})

	it('passes host/port/password via env, never on argv', async () => {
		const { exec } = await applyTarget('postgres://u:secret@db.example:6543/appdb')
		expect(exec.env).toMatchObject({
			PGHOST: 'db.example',
			PGPORT: '6543',
			PGPASSWORD: 'secret',
		})
		expect(exec.args).not.toContain('secret')
	})

	it('parses connection parts and defaults the port to 5432', async () => {
		const out = await applyTarget('postgres://alice:pw@host/mydb')
		expect(out).toMatchObject({
			host: 'host',
			port: 5432,
			user: 'alice',
			password: 'pw',
			database: 'mydb',
		})
	})
})
