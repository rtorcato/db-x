// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<Postgres>` — the logical database. It does NOT manage the server
// lifecycle; that belongs to the parent runtime (`<DatabaseTarget>` for
// remote / production, `<Service image="postgres:..." />` from
// @db-x/docker-library for local).
//
// `<Postgres>` republishes the runtime parent's `exec` record together
// with the credentials, so child components (`<Extension>`, `<Table>`,
// `<SeedData>`, `<DbUser>`) work identically across runtimes.

import { type Ctx, type PlanAction, type ResourceState, defineComponent } from '@db-x/runtime'
import { type PostgresParentOutputs, queryJson, requireRuntimeParent } from './exec.js'

export interface PostgresProps {
	/** Logical name. Used only to derive the resource id (`postgres:<name>`). */
	name?: string
	/** Connection user. Defaults to the runtime parent's `user` output if set. */
	user?: string
	/** Connection password. Defaults to the runtime parent's `password` output. */
	password?: string
	/** Database name. Defaults to the runtime parent's `database` output. */
	database?: string
	/**
	 * Hard-lock this database's subtree against destructive DDL. When set,
	 * `db-x apply` refuses any destructive change (DROP, ALTER TYPE, …) on this
	 * `<Postgres>` or its children **even with** `--allow-destructive` — you
	 * must remove `protect` from the JSX to proceed. This is the deliberate,
	 * in-code guard (Terraform `prevent_destroy` style); `--allow-destructive`
	 * is the weaker global opt-in for unprotected resources.
	 *
	 * Enforced by the runtime destructive guard (see `findDestructiveViolations`).
	 * A pre-flight snapshot on protected applies lands with the snapshot driver.
	 */
	protect?: boolean
	/**
	 * What a pre-flight snapshot captures before a destructive apply.
	 *
	 *   `schema` (default) — structure only. Fast and small on any database,
	 *     but `db-x restore` brings back the schema and NOT the rows: a dropped
	 *     column's data is gone for good.
	 *   `full` — structure and row data, so a restore actually undoes the
	 *     migration. The dump runs inline before the apply and holds a
	 *     transaction open for its duration, so on a large database this is
	 *     slow and hostile to vacuum. Deliberate, per-database opt-in.
	 *
	 * SQLite and MongoDB have no equivalent knob — their tools always capture
	 * everything (see @db-x/snapshot-sqlite, @db-x/snapshot-mongodump).
	 */
	snapshot?: 'schema' | 'full'
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export const Postgres = defineComponent<PostgresProps, PostgresParentOutputs>({
	kind: '@db-x/postgres-library:postgres',
	apply: async (props, ctx) => {
		const runtime = requireRuntimeParent(ctx, 'Postgres')
		const user = props.user ?? runtime.user
		const password = props.password ?? runtime.password
		const database = props.database ?? runtime.database

		if (!user || !password || !database) {
			throw new Error(
				'<Postgres>: user / password / database must be supplied as props or via a <DatabaseTarget> parent.'
			)
		}

		const connection: PostgresParentOutputs = {
			user,
			password,
			database,
			exec: runtime.exec,
		}
		const serverKind = await detectServerKind(connection, ctx)

		ctx.log.info(
			`Postgres ready (database=${database}, user=${user}, server=${serverKind}${props.protect ? ', protect=on' : ''})`
		)

		return {
			...connection,
			serverKind,
			// CockroachDB speaks the pg wire protocol, but `pg_dump` does not work
			// against it — see `snapshotUnsupported`. Tagging it `pg-dump` anyway
			// would have the CLI capture an archive that cannot restore, which is
			// the one failure a safety net must not have.
			...(serverKind === 'cockroachdb'
				? { snapshotUnsupported: 'cockroachdb' as const }
				: { snapshotDriver: 'pg-dump' as const }),
			snapshotMode: props.snapshot ?? 'schema',
		}
	},
	destroy: async (state, ctx) => {
		// The Postgres *server* lifecycle is owned by the parent runtime —
		// either `<DatabaseTarget>` (already-existing DB, never destroyed) or
		// a `<Service>` (docker-compose teardown). This component only
		// republishes connection metadata.
		ctx.log.info(
			`Postgres ${state.outputs.database}: no-op destroy (server owned by parent runtime)`
		)
	},
	plan: (props, state): PlanAction => {
		if (!state) return { type: 'create' }
		// State written before the server probe existed carries no `serverKind`,
		// and a `no-op` never re-applies — so without this the stale
		// `snapshotDriver: 'pg-dump'` tag would outlive the fix on exactly the
		// databases it was added for. One cheap re-apply per database settles it.
		if (state.outputs.serverKind === undefined) {
			return { type: 'update', reason: 'server kind not yet detected' }
		}
		return JSON.stringify(props) === JSON.stringify(state.props)
			? { type: 'no-op' }
			: { type: 'update', reason: 'props changed' }
	},
})

/**
 * Which engine is actually answering. CockroachDB speaks the pg wire protocol
 * and reports itself through `version()` like Postgres does, so one cheap query
 * settles it — and it is the only honest way: nothing about the connection URL
 * or the port distinguishes them.
 *
 * A probe that can't reach the server assumes Postgres, which is what this
 * component did before the probe existed. Failing here instead would turn an
 * unreachable database into an error from `<Postgres>` rather than from the
 * first statement that actually needs it.
 */
async function detectServerKind(
	connection: PostgresParentOutputs,
	ctx: Ctx
): Promise<'postgres' | 'cockroachdb'> {
	try {
		const rows = await queryJson(
			connection,
			connection.user,
			connection.database,
			'select version() as version',
			ctx
		)
		const version = String(rows[0]?.version ?? '')
		return /cockroach/i.test(version) ? 'cockroachdb' : 'postgres'
	} catch (err) {
		ctx.log.debug?.(`server probe failed, assuming postgres: ${(err as Error).message}`)
		return 'postgres'
	}
}

/**
 * Compose a `postgres://` URL from the parts a `<Postgres>` knows
 * about. Handy when an app service downstream needs `DATABASE_URL`.
 */
export function pgUrl(
	host: string,
	user: string,
	password: string,
	database: string,
	port = 5432
): string {
	const u = encodeURIComponent(user)
	const p = encodeURIComponent(password)
	return `postgres://${u}:${p}@${host}:${port}/${database}`
}

// Re-export for callers that want the state shape.
export type PostgresState = ResourceState<PostgresProps, PostgresParentOutputs>
