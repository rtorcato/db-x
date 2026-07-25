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

import { type PlanAction, type ResourceState, defineComponent } from '@db-x/runtime'
import { type PostgresParentOutputs, requireRuntimeParent } from './exec.js'

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
	 * When set, the `db-x` CLI requires `--allow-destructive` for any
	 * DROP / TYPE-narrowing / REVOKE on a child resource, and takes a
	 * pre-flight snapshot before applying.
	 *
	 * v0.0 caveat: the flag is captured and propagated, but the CLI
	 * enforcement is not wired up yet (see TODO.md / GOALS.md).
	 */
	protect?: boolean
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

		ctx.log.info(
			`Postgres ready (database=${database}, user=${user}${props.protect ? ', protect=on' : ''})`
		)

		return {
			user,
			password,
			database,
			exec: runtime.exec,
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
		return JSON.stringify(props) === JSON.stringify(state.props)
			? { type: 'no-op' }
			: { type: 'update', reason: 'props changed' }
	},
})

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
