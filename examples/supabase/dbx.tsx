/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X Supabase demo — standalone entry. Wires the connection (`./config` →
 * `<DatabaseTarget>`) around the reusable schema in `./schema` (`TodosSchema`).
 *
 * Supabase is a hosted Postgres, so there's no server to stand up — DB-X only
 * manages schema. Point `DATABASE_URL` at a local `supabase start` stack
 * (the `.env.example` default) or a hosted project's direct connection string,
 * and `db-x apply` runs the DDL against it. See `./schema` for the
 * Supabase-specific bits (auth.users FK + Row Level Security).
 */

import { DatabaseTarget } from '@db-x/postgres-library'
import { DATABASE_URL, TODOS_PG } from './config'
import { TodosSchema } from './schema'

export default (
	<DatabaseTarget url={DATABASE_URL} description="Supabase todos database">
		<TodosSchema {...TODOS_PG} />
	</DatabaseTarget>
)
