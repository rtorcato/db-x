// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<Mongo>` — the logical database plus the connection that reaches it.
//
// Postgres splits these (`<DatabaseTarget>` owns the connection, `<Postgres>`
// the database) because the same schema tree gets pointed at a docker
// `<Service>` parent or a remote URL. Mongo has no such split to model yet:
// there is one way in (a connection URI) and mongosh is the only tool. So this
// collapses to a single component, the way `<Sqlite>` does — a `<MongoTarget>`
// wrapping one implementation would be ceremony. Split it when a second
// runtime parent (docker exec, ssh) actually exists.
//
// The server lifecycle is never owned here: we manage collections, indexes and
// validators inside an existing database, never the database server itself.

import { type PlanAction, defineComponent } from '@db-x/runtime'
import type { MongoParentOutputs } from './exec.js'

export interface MongoProps {
	/** Logical name. Used only to derive the resource id (`mongo:<name>`). */
	name?: string
	/**
	 * Connection URI — `mongodb://…` or `mongodb+srv://…`. Passed to mongosh
	 * verbatim, so every URI shape works (replica sets, SRV, `?options`).
	 *
	 * Security: mongosh has no `PGPASSWORD` equivalent, so a URI with an inline
	 * password is visible in `ps` while the command runs. DB-X masks it in its
	 * own logs and errors, but on a shared host prefer a passwordless auth
	 * mechanism (X.509, AWS IAM) or a URI without credentials.
	 */
	url: string
	/**
	 * Database to apply the schema to. Required and explicit: every emitted
	 * statement is bound to it via `getSiblingDB`, so the URI's default
	 * database (present, absent, or shadowed by `?options`) never decides
	 * where DDL lands.
	 */
	database: string
	/**
	 * Hard-lock this database's subtree against destructive changes. When set,
	 * `db-x apply` refuses any destructive change (dropping an index, dropping
	 * a collection, tightening a validator) on this `<Mongo>` or its children
	 * **even with** `--allow-destructive` — you must remove `protect` from the
	 * JSX to proceed.
	 *
	 * Enforced by the runtime destructive guard (see `findDestructiveViolations`).
	 */
	protect?: boolean
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export const Mongo = defineComponent<MongoProps, MongoParentOutputs>({
	kind: '@db-x/mongodb-library:mongo',
	apply: async (props, ctx) => {
		if (!/^mongodb(\+srv)?:\/\//.test(props.url)) {
			throw new Error(
				`<Mongo>: url must use the mongodb:// or mongodb+srv:// scheme (got "${props.url.split(':')[0]}:")`
			)
		}
		if (!props.database) {
			throw new Error('<Mongo>: database is required — it is not inferred from the URI.')
		}

		ctx.log.info(`Mongo ready (database=${props.database}${props.protect ? ', protect=on' : ''})`)

		return {
			database: props.database,
			uri: props.url,
			// Pass-through wrapper: `env` runs whatever tool the consumer appends
			// (`mongosh` for DDL, `mongodump` / `mongorestore` for snapshots).
			// Mirrors `<DatabaseTarget>`; naming one tool as `command` would
			// hardcode it.
			exec: { command: 'env', args: [] },
			snapshotDriver: 'mongodump',
		}
	},
	destroy: async (state, ctx) => {
		// We don't own the database server, and an empty Mongo database is not
		// a thing that exists — dropping the collections (each `<Collection>`'s
		// own destroy) is the whole teardown.
		ctx.log.info(`Mongo ${state.outputs.database}: no-op destroy (server not owned)`)
	},
	plan: (props, state): PlanAction => {
		if (!state) return { type: 'create' }
		return JSON.stringify(props) === JSON.stringify(state.props)
			? { type: 'no-op' }
			: { type: 'update', reason: 'props changed' }
	},
})
