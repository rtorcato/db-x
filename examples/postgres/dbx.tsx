/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X demo — standalone entry. Wires the connection (env → `<DatabaseTarget>`)
 * around the reusable schema in `./schema` (`TodosSchema`).
 *
 * What this shows:
 *  - Production-style connection via `<DatabaseTarget url=...>` against an
 *    existing database (a local container or a managed DB — no docker required).
 *  - `protect` on `<Postgres>` (in `./schema`): destructive ops require
 *    `db-x apply --allow-destructive`.
 *  - `description={...}` on every component so `db-x describe` / the MCP server
 *    can answer "what is this and why" for an AI agent reviewing the change.
 */

import { DatabaseTarget } from '@db-x/postgres-library'
import { DATABASE_URL, READONLY_PASSWORD, TODOS_PG } from './config'
import { TodosSchema } from './schema'

export default (
	<DatabaseTarget url={DATABASE_URL} description="Production todos database">
		<TodosSchema {...TODOS_PG} readonlyPassword={READONLY_PASSWORD} />
	</DatabaseTarget>
)
