/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * The `todos` schema for CockroachDB — reusable component, split from the
 * connection entry (`dbx.tsx`). CockroachDB speaks the Postgres wire protocol,
 * so it rides `@db-x/postgres-library` unchanged: same `<Postgres>`, `<Table>`,
 * `<Column>`, `<Index>` components, connected via `<DatabaseTarget>` in
 * `dbx.tsx`. No new library.
 *
 * CockroachDB DDL deltas this schema stays inside (verified against
 * cockroachdb/cockroach:latest):
 *  - No `CREATE EXTENSION` — citext / pgcrypto are unimplemented
 *    (`SQLSTATE 0A000`). So no `<Extension>`; `title` is plain `text`, not
 *    `citext`. `gen_random_uuid()` is built in (no pgcrypto needed).
 *  - `now()` and `timestamptz` work as in Postgres.
 */

import { Column, Index, Postgres, SeedData, Table } from '@db-x/postgres-library'

export interface TodosSchemaProps {
	/** Schema owner credentials — passed by the entry file from env. */
	user?: string
	password?: string
	database?: string
}

/**
 * The todos schema. `user` / `password` / `database` are supplied by the
 * connection entry (the CockroachDB `root` role for the local demo).
 */
export function TodosSchema(props: TodosSchemaProps = {}) {
	return (
		<Postgres
			name="todos-db"
			user={props.user}
			password={props.password}
			database={props.database}
			protect
			description="Schema owner: todos service on CockroachDB. Rolls back via db-x restore <id>."
		>
			<Table name="todos" description="User-visible todo items">
				<Column name="id" type="uuid" primaryKey default="gen_random_uuid()" />
				<Column name="title" type="text" notNull />
				<Column name="done" type="boolean" notNull default="false" />
				<Column name="priority" type="int" notNull default="0" />
				<Column name="created_at" type="timestamptz" notNull default="now()" />

				<Index name="idx_todos_done" columns={['done']} />
				<Index name="idx_todos_priority_done" columns={['priority', 'done']} />
			</Table>

			<SeedData
				name="initial-todos"
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (title, done) VALUES
            ('try the db-x cockroachdb demo', true),
            ('read the README', false),
            ('point DATABASE_URL at CockroachDB Cloud', false)
          ON CONFLICT DO NOTHING
        `}
			/>
		</Postgres>
	)
}
