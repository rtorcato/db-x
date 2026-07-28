/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X CockroachDB demo — standalone entry. Wires the connection (env →
 * `<DatabaseTarget>`) around the reusable schema in `./schema` (`TodosSchema`).
 *
 * CockroachDB is wire-compatible with Postgres, so there's nothing
 * CockroachDB-specific here: the same `<DatabaseTarget url={...}>` that points
 * at Postgres points at CockroachDB (or Neon / Yugabyte / AlloyDB / Aurora PG)
 * — only the URL changes. `db-x apply` runs the DDL against it. See `./schema`
 * for the CockroachDB DDL deltas the schema stays inside.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseTarget } from '@db-x/postgres-library'
import { getENV } from '@rtorcato/js-common/env'
import dotenv from 'dotenv'
import { TodosSchema } from './schema'

// First-run bootstrap: if `.env` doesn't exist, copy `.env.example` to `.env`
// so the demo runs out of the box. `.env.example` is documentation only; real
// values live in `.env` (gitignored). Paths resolved relative to this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '.env')
const examplePath = path.join(__dirname, '.env.example')
if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
	fs.copyFileSync(examplePath, envPath)
	console.error('[dbx-demo] created .env from .env.example — edit it to customize.')
}
dotenv.config({ path: envPath })

/**
 * Connection settings — read from `.env` / `.env.example`. No hardcoded
 * credentials; passed into `<TodosSchema>` and used to build the URL.
 */
export const TODOS_PG = {
	user: getENV('TODOS_DB_USER'),
	password: getENV('TODOS_DB_PASSWORD'),
	database: getENV('TODOS_DB_NAME'),
}

// DATABASE_URL: set explicitly in `.env` (a CockroachDB Cloud string), or
// derived from the TODOS_DB_* parts (the local docker single-node on :26257).
const DATABASE_URL =
	process.env.DATABASE_URL ??
	`postgres://${TODOS_PG.user}:${TODOS_PG.password}@${getENV('TODOS_DB_HOST')}:${getENV('TODOS_DB_PORT')}/${TODOS_PG.database}`

export default (
	<DatabaseTarget url={DATABASE_URL} description="CockroachDB todos database">
		<TodosSchema {...TODOS_PG} />
	</DatabaseTarget>
)
