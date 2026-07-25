// `<SeedData>` — inline SQL run once at apply time. Re-runs only when
// the SQL prop changes (the diff sees `~ update`). For idempotent
// inserts, include `ON CONFLICT DO NOTHING` in the SQL.
//
// Must be a child of `<Postgres>`. Inherits `user` / `database` from
// that parent unless overridden.

import { defineComponent } from '@db-x/runtime'
import { requirePostgresParent, runSql } from './exec.js'

export interface SeedDataProps {
	name: string
	/** Inline SQL — typically INSERT … ON CONFLICT DO NOTHING for idempotency. */
	sql: string
	user?: string
	database?: string
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export interface SeedDataOutputs {
	name: string
	ranAt: string
	[key: string]: unknown
}

export const SeedData = defineComponent<SeedDataProps, SeedDataOutputs>({
	kind: '@db-x/postgres-library:seed',
	apply: async (props, ctx) => {
		const parent = requirePostgresParent(ctx, 'SeedData')
		const user = props.user ?? parent.user
		const database = props.database ?? parent.database
		ctx.log.info(`Seeding ${props.name}`)
		await runSql(parent, user, database, props.sql, ctx)
		return { name: props.name, ranAt: new Date().toISOString() }
	},
	destroy: async (state, ctx) => {
		// No-op by design. Seed data lives with its table; dropping the
		// table takes the rows with it. Re-applying with new SQL is the way
		// to evolve.
		ctx.log.info(`SeedData ${state.outputs.name}: no-op destroy`)
	},
})
