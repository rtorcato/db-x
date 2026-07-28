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

// DATABASE_URL: set explicitly in `.env`, or derived from the TODOS_DB_* parts.
const DATABASE_URL =
	process.env.DATABASE_URL ??
	`postgres://${TODOS_PG.user}:${TODOS_PG.password}@${getENV('TODOS_DB_HOST')}:${getENV('TODOS_DB_PORT')}/${TODOS_PG.database}`

export default (
	<DatabaseTarget url={DATABASE_URL} description="Production todos database">
		<TodosSchema {...TODOS_PG} readonlyPassword={getENV('READONLY_PASSWORD')} />
	</DatabaseTarget>
)
