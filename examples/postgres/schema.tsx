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

export interface TodosSchemaProps {
	/** Schema owner credentials — passed by the entry file from env. */
	user?: string
	password?: string
	database?: string
	/** Password for the read-only role — also passed by the entry file. */
	readonlyPassword: string
}

/**
 * The todos schema. All credentials — owner and the read-only role — are
 * supplied by the connection entry (`dbx.tsx`), which owns env loading. This
 * component reads no env itself, so it stays reusable under any parent.
 */
export function TodosSchema(props: TodosSchemaProps) {
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

			{/*
			 * `ON CONFLICT DO NOTHING` needs something to conflict *with*. The id
			 * defaults to gen_random_uuid(), so every run minted a new key, hit no
			 * unique violation, and appended a duplicate set of rows — the clause
			 * read as a safety net while doing nothing at all. Pinning the uuids
			 * gives the primary key as a real target, and DO UPDATE makes the seed
			 * declarative: edit a value here and the existing row changes.
			 */}
			<SeedData
				name="initial-todos"
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (id, title, done) VALUES
            ('11111111-1111-4111-8111-111111111111', 'try the db-x demo', true),
            ('22222222-2222-4222-8222-222222222222', 'read the README', false),
            ('33333333-3333-4333-8333-333333333333', 'preview a destructive change with db-x preview --shadow', false)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            done = excluded.done
        `}
			/>

			<DbUser
				name="todos_readonly"
				password={props.readonlyPassword}
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
