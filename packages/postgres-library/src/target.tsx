// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<DatabaseTarget>` — production-style connection parent for `<Postgres>`.
//
// Parses a `postgres://user:pass@host:port/db` URL and publishes a
// `RuntimeExec` that runs `psql` directly with PGHOST / PGPORT /
// PGPASSWORD set in env. Children (`<Postgres>` and friends) read this
// the same way they'd read a `<Service>` parent in DB-X, so the
// component tree is identical regardless of whether the DB is local
// (docker-compose) or remote (managed RDS / Cloud SQL / a VPS).
//
// Unlike `<Service>`, `<DatabaseTarget>` does NOT own the database
// lifecycle. We never create or destroy the server — only schema.

import { type RuntimeExec, defineComponent } from '@db-x/runtime'

export interface DatabaseTargetProps {
	/** `postgres://user:pass@host:port/database` */
	url: string
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export interface DatabaseTargetOutputs {
	exec: RuntimeExec
	host: string
	port: number
	/** Default user — `<Postgres user>` overrides if set. */
	user: string
	/** Default password — `<Postgres password>` overrides if set. */
	password: string
	/** Default database — `<Postgres database>` overrides if set. */
	database: string
	[key: string]: unknown
}

export const DatabaseTarget = defineComponent<DatabaseTargetProps, DatabaseTargetOutputs>({
	kind: '@db-x/postgres-library:database-target',
	apply: async (props, ctx) => {
		const parsed = parseUrl(props.url)

		// The exec record drives `psql -U <user> -d <db> -c <sql>` invocations
		// from child components. PGHOST/PGPORT/PGPASSWORD are passed via env so
		// they don't appear in argv or process listings.
		const exec: RuntimeExec = {
			command: 'psql',
			args: [],
			env: {
				PGHOST: parsed.host,
				PGPORT: String(parsed.port),
				PGPASSWORD: parsed.password,
			},
		}

		ctx.log.info(`DatabaseTarget pointing at ${parsed.host}:${parsed.port}/${parsed.database}`)

		return {
			exec,
			host: parsed.host,
			port: parsed.port,
			user: parsed.user,
			password: parsed.password,
			database: parsed.database,
		}
	},
	destroy: async (state, ctx) => {
		// We don't own the database server — never destroy it.
		ctx.log.info(`DatabaseTarget ${state.outputs.host}: no-op destroy (not owned)`)
	},
})

interface ParsedUrl {
	host: string
	port: number
	user: string
	password: string
	database: string
}

function parseUrl(raw: string): ParsedUrl {
	let url: URL
	try {
		url = new URL(raw)
	} catch (err) {
		throw new Error(`<DatabaseTarget>: invalid url "${raw}": ${(err as Error).message}`)
	}
	if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
		throw new Error(
			`<DatabaseTarget>: url must use postgres:// or postgresql:// scheme (got ${url.protocol})`
		)
	}
	const database = url.pathname.replace(/^\//, '')
	if (!database) {
		throw new Error('<DatabaseTarget>: url must include a database name (e.g. postgres://…/mydb)')
	}
	return {
		host: url.hostname,
		port: url.port ? Number(url.port) : 5432,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database,
	}
}
