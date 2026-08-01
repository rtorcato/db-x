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
				// The rows live in `todos`, so the seed is downstream of it. Raw SQL
				// is opaque to the runtime — declaring the edge is what orders the
				// two AND re-runs this seed when the table is rebuilt empty.
				dependsOn={['table:todos']}
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (id, title, done) VALUES
            ('11111111-1111-4111-8111-111111111111', 'try the db-x cockroachdb demo', true),
            ('22222222-2222-4222-8222-222222222222', 'read the README', false),
            ('33333333-3333-4333-8333-333333333333', 'point DATABASE_URL at CockroachDB Cloud', false)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            done = excluded.done
        `}
			/>
		</Postgres>
	)
}
