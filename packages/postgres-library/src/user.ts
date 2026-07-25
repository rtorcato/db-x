// `<DbUser>` — CREATE ROLE + GRANT, idempotently.
//
// Must be a child of `<Postgres>`. `user` (the superuser to connect as)
// and `database` default to the parent `<Postgres>`'s values.

import { defineComponent } from '@db-x/runtime'
import { findPostgresParent, requirePostgresParent, runSql } from './exec.js'

export interface DbUserPrivileges {
	/** Database-level privileges, e.g. ['CONNECT']. */
	database?: string[]
	/** Schema-level (public) privileges, e.g. ['USAGE']. */
	schema?: string[]
	/** Table-level privileges applied to ALL TABLES IN SCHEMA public. */
	table?: string[]
}

export interface DbUserProps {
	/** Role name to create. */
	name: string
	/** Role password. */
	password: string
	/** Superuser to connect as for the CREATE/GRANT. Defaults to the parent `<Postgres user>`. */
	user?: string
	/** Database to grant privileges on. Defaults to the parent `<Postgres database>`. */
	database?: string
	privileges?: DbUserPrivileges
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export interface DbUserOutputs {
	name: string
	[key: string]: unknown
}

export const DbUser = defineComponent<DbUserProps, DbUserOutputs>({
	kind: '@db-x/postgres-library:user',
	apply: async (props, ctx) => {
		const parent = requirePostgresParent(ctx, 'DbUser')
		const user = props.user ?? parent.user
		const database = props.database ?? parent.database
		ctx.log.info(`Ensuring db user ${props.name}`)

		// CREATE ROLE isn't idempotent — wrap in a DO block.
		const create = `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${props.name}') THEN
          CREATE ROLE "${props.name}" LOGIN PASSWORD '${props.password.replace(/'/g, "''")}';
        ELSE
          ALTER ROLE "${props.name}" WITH LOGIN PASSWORD '${props.password.replace(/'/g, "''")}';
        END IF;
      END
      $$;`
		await runSql(parent, user, database, create, ctx)

		const priv = props.privileges ?? {}
		const grants: string[] = []
		if (priv.database?.length) {
			grants.push(`GRANT ${priv.database.join(', ')} ON DATABASE "${database}" TO "${props.name}"`)
		}
		if (priv.schema?.length) {
			grants.push(`GRANT ${priv.schema.join(', ')} ON SCHEMA public TO "${props.name}"`)
		}
		if (priv.table?.length) {
			grants.push(
				`GRANT ${priv.table.join(', ')} ON ALL TABLES IN SCHEMA public TO "${props.name}"`
			)
			// Make future tables inherit the grants.
			grants.push(
				`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ${priv.table.join(', ')} ON TABLES TO "${props.name}"`
			)
		}
		if (grants.length) {
			await runSql(parent, user, database, grants.join(';\n'), ctx)
		}

		return { name: props.name }
	},
	destroy: async (state, ctx) => {
		const parent = findPostgresParent(ctx)
		if (!parent) {
			ctx.log.warn(`Parent postgres missing; skipping drop of role ${state.outputs.name}`)
			return
		}
		const user = state.props.user ?? parent.user
		const database = state.props.database ?? parent.database
		ctx.log.info(`Dropping db user ${state.outputs.name}`)
		try {
			// REASSIGN / DROP OWNED first to clear privilege references.
			await runSql(
				parent,
				user,
				database,
				`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${state.outputs.name}') THEN
              EXECUTE 'REASSIGN OWNED BY "${state.outputs.name}" TO "${user}"';
              EXECUTE 'DROP OWNED BY "${state.outputs.name}"';
              EXECUTE 'DROP ROLE "${state.outputs.name}"';
            END IF;
          END
          $$;`,
				ctx
			)
		} catch (err) {
			ctx.log.warn(`drop role failed: ${(err as Error).message}`)
		}
	},
})
