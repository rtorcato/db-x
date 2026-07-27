/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X demo — SQLite todos, the simplest possible target.
 *
 * Unlike `examples/postgres`, there's no connection URL or creds: the file
 * *is* the database. `SQLITE_FILE` (optional) picks where it lives; the demo
 * runs out of the box with no `.env` at all.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Sqlite } from '@db-x/sqlite-library'
import dotenv from 'dotenv'
import { TodosSchema } from './schema.js'

// First-run bootstrap: if `.env` doesn't exist, copy `.env.example` to
// `.env` so the demo runs out of the box. Paths resolved relative to this
// file so it works from any cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '.env')
const examplePath = path.join(__dirname, '.env.example')
if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
	fs.copyFileSync(examplePath, envPath)
	console.error('[dbx-demo] created .env from .env.example — edit it to customize.')
}
dotenv.config({ path: envPath })

const file = process.env.SQLITE_FILE ?? './todos.db'

export default (
	<Sqlite name="todos-db" file={file} description="Local todos database">
		<TodosSchema />
	</Sqlite>
)
