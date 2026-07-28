/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X demo — SQLite todos, the simplest possible target.
 *
 * Unlike `examples/postgres`, there's no connection URL or creds: the file
 * *is* the database. `SQLITE_FILE` (optional, see `./config`) picks where it
 * lives; the demo runs out of the box with no `.env` at all.
 */

import { Sqlite } from '@db-x/sqlite-library'
import { SQLITE_FILE } from './config'
import { TodosSchema } from './schema.js'

export default (
	<Sqlite name="todos-db" file={SQLITE_FILE} description="Local todos database">
		<TodosSchema />
	</Sqlite>
)
