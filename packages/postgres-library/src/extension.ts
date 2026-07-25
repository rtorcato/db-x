// `<Extension>` — install / remove a Postgres extension.
//
// Must be a child of `<Postgres>`. Inherits `user` / `database` from
// that parent unless overridden.

import { defineComponent } from '@db-x/runtime'
import { findPostgresParent, requirePostgresParent, runSql } from './exec.js'

export interface ExtensionProps {
	/** Extension name, e.g. `pgcrypto`, `uuid-ossp`, `citext`. */
	name: string
	/** Postgres user to run CREATE EXTENSION as. Defaults to the parent `<Postgres user>`. */
	user?: string
	/** Database to install into. Defaults to the parent `<Postgres database>`. */
	database?: string
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export interface ExtensionOutputs {
	name: string
	installedIn: string
	[key: string]: unknown
}

export const Extension = defineComponent<ExtensionProps, ExtensionOutputs>({
	kind: '@db-x/postgres-library:extension',
	apply: async (props, ctx) => {
		const parent = requirePostgresParent(ctx, 'Extension')
		const user = props.user ?? parent.user
		const database = props.database ?? parent.database
		ctx.log.info(`Installing extension ${props.name} into ${database}`)
		await runSql(parent, user, database, `CREATE EXTENSION IF NOT EXISTS "${props.name}"`, ctx)
		return { name: props.name, installedIn: database }
	},
	destroy: async (state, ctx) => {
		const parent = findPostgresParent(ctx)
		if (!parent) {
			ctx.log.warn('Parent postgres missing; assuming extension already gone')
			return
		}
		const user = state.props.user ?? parent.user
		const database = state.props.database ?? parent.database
		ctx.log.info(`Dropping extension ${state.outputs.name}`)
		try {
			await runSql(
				parent,
				user,
				database,
				`DROP EXTENSION IF EXISTS "${state.outputs.name}" CASCADE`,
				ctx
			)
		} catch (err) {
			ctx.log.warn(`drop failed: ${(err as Error).message}`)
		}
	},
})
