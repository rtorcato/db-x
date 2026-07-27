/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * The `todos` schema as a reusable component — split out from the connection
 * entry (`dbx.tsx`) so the schema definition stands on its own. Drop it inside
 * any runtime parent that publishes a `RuntimeExec`: `<DatabaseTarget>` for
 * production (see `dbx.tsx`), or an `@infra-x/docker-library` `<Service>` for
 * local docker.
 *
 * Renames via `<Column from="oldName">` are part of the API but aren't
 * exercised here — a `from=` on first apply errors (nothing to rename from).
 * To demo one: apply once, then rename a column and add `from="oldName"`.
 */

import { Column, DbUser, Extension, Index, Postgres, SeedData, Table } from '@db-x/postgres-library'
import { getENV } from '@rtorcato/js-common/env'

export interface TodosSchemaProps {
	/** Schema owner credentials — passed by the entry file from env. */
	user?: string
	password?: string
	database?: string
}

/**
 * The todos schema. `user` / `password` / `database` are supplied by the
 * connection entry; the read-only role's password comes from env at render.
 */
export function TodosSchema(props: TodosSchemaProps = {}) {
	return (
		<Postgres
			name="todos-db"
			user={props.user}
			password={props.password}
			database={props.database}
			protect
			description="Schema owner: todos service. Rolls back via db-x restore <id>."
		>
			<Extension name="pgcrypto" description="Used by todos.id default gen_random_uuid()" />
			<Extension name="citext" description="Case-insensitive text type for todos.title search" />

			<Table name="todos" description="User-visible todo items">
				<Column name="id" type="uuid" primaryKey default="gen_random_uuid()" />
				<Column name="title" type="citext" notNull />
				<Column name="done" type="boolean" notNull default="false" />
				<Column name="priority" type="int" notNull default="0" />
				<Column name="created_at" type="timestamptz" notNull default="now()" />

				<Index name="idx_todos_done" columns={['done']} />
				<Index name="idx_todos_created_at" columns={['created_at']} />
				<Index name="idx_todos_priority_done" columns={['priority', 'done']} />
			</Table>

			<SeedData
				name="initial-todos"
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (title, done) VALUES
            ('try the db-x demo', true),
            ('read the README', false),
            ('preview a destructive change with db-x preview --shadow', false)
          ON CONFLICT DO NOTHING
        `}
			/>

			<DbUser
				name="todos_readonly"
				password={getENV('READONLY_PASSWORD')}
				description="Used by reporting + the marketing dashboard"
				privileges={{
					database: ['CONNECT'],
					schema: ['USAGE'],
					table: ['SELECT'],
				}}
			/>
		</Postgres>
	)
}
