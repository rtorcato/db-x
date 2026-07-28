/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X MongoDB demo — standalone entry. Wires the connection (`./config` →
 * `<Mongo>`) around the reusable schema in `./schema` (`TodosSchema`).
 *
 * Unlike the Postgres demo there is no `<DatabaseTarget>` / `<Postgres>` split:
 * `<Mongo url database>` is both. See `./schema` for the collection, indexes
 * and validator this manages.
 */

import { MONGODB_URL, TODOS_DB } from './config'
import { TodosSchema } from './schema'

export default <TodosSchema url={MONGODB_URL} database={TODOS_DB} />
