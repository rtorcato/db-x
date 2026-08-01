/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * The `todos` schema for Supabase — reusable component, split from the
 * connection entry (`dbx.tsx`). Supabase is plain Postgres, so the same
 * `@db-x/postgres-library` components apply. What makes this the *Supabase*
 * example rather than the plain-postgres one:
 *
 *  - `user_id` references Supabase's managed `auth.users` table (owned by the
 *    Supabase Auth service — DB-X never creates it).
 *  - Row Level Security is enabled with an owner-only policy keyed on
 *    `auth.uid()`, Supabase's helper that returns the caller's JWT user id.
 *
 * There's no dedicated `<Policy>` / foreign-key component, so the FK and the
 * RLS policy go through a `<SeedData>` block of raw SQL — written idempotent
 * (DROP … IF EXISTS before CREATE) so re-applying is safe.
 */

import { Column, Extension, Index, Postgres, SeedData, Table } from '@db-x/postgres-library'

export interface TodosSchemaProps {
	/** Schema owner credentials — passed by the entry file from env. */
	user?: string
	password?: string
	database?: string
}

/**
 * The todos schema. `user` / `password` / `database` are supplied by the
 * connection entry (the Supabase `postgres` role).
 */
export function TodosSchema(props: TodosSchemaProps = {}) {
	return (
		<Postgres
			name="todos-db"
			user={props.user}
			password={props.password}
			database={props.database}
			protect
			description="Schema owner: todos service on Supabase. Rolls back via db-x restore <id>."
		>
			<Extension name="citext" description="Case-insensitive text type for todos.title search" />

			<Table name="todos" description="Per-user todo items, owned via auth.users">
				<Column name="id" type="uuid" primaryKey default="gen_random_uuid()" />
				<Column
					name="user_id"
					type="uuid"
					notNull
					description="Owner — references auth.users(id); enforced by RLS below"
				/>
				<Column name="title" type="citext" notNull />
				<Column name="done" type="boolean" notNull default="false" />
				<Column name="created_at" type="timestamptz" notNull default="now()" />

				<Index name="idx_todos_user_id" columns={['user_id']} />
				<Index name="idx_todos_done" columns={['done']} />
			</Table>

			<SeedData
				name="rls-and-ownership"
				// The FK and the policy hang off `todos`, so this is downstream of it.
				// Raw SQL is opaque to the runtime — declaring the edge is what orders
				// the two AND re-applies the policy when the table is rebuilt.
				dependsOn={['table:todos']}
				description="FK to auth.users + owner-only Row Level Security policy (auth.uid() = user_id)"
				sql={`
          -- Owner FK to Supabase's managed auth.users. DROP-then-ADD keeps it idempotent.
          ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_user_id_fkey;
          ALTER TABLE todos ADD CONSTRAINT todos_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

          -- Row Level Security: a user can only see and mutate their own rows.
          ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

          DROP POLICY IF EXISTS "Users manage their own todos" ON todos;
          CREATE POLICY "Users manage their own todos" ON todos
            FOR ALL
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
        `}
			/>
		</Postgres>
	)
}
