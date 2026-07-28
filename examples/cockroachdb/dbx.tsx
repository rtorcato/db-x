/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X CockroachDB demo — standalone entry. Wires the connection
 * (`./config` → `<DatabaseTarget>`) around the reusable schema in `./schema`
 * (`TodosSchema`).
 *
 * CockroachDB is wire-compatible with Postgres, so there's nothing
 * CockroachDB-specific here: the same `<DatabaseTarget url={...}>` that points
 * at Postgres points at CockroachDB (or Neon / Yugabyte / AlloyDB / Aurora PG)
 * — only the URL changes. `db-x apply` runs the DDL against it. See `./schema`
 * for the CockroachDB DDL deltas the schema stays inside.
 */

import { DatabaseTarget } from '@db-x/postgres-library'
import { DATABASE_URL, TODOS_PG } from './config'
import { TodosSchema } from './schema'

export default (
	<DatabaseTarget url={DATABASE_URL} description="CockroachDB todos database">
		<TodosSchema {...TODOS_PG} />
	</DatabaseTarget>
)
