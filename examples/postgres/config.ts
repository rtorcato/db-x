// Env loading + connection settings for the todos demo. Split out of
// `dbx.tsx` so the entry file is nothing but the component tree — the JSX is
// what the example is teaching; dotenv plumbing is not.

import fs from 'node:fs'
import path from 'node:path'
import { getENV } from '@rtorcato/js-common/env'
import dotenv from 'dotenv'

// First-run bootstrap: if `.env` doesn't exist, copy `.env.example` to `.env`
// so the demo runs out of the box. `.env.example` is documentation only; real
// values live in `.env` (gitignored). Paths resolved relative to this file so
// it works from any cwd — `import.meta.dirname` needs Node 20.11+, and the
// repo requires 22.
const envPath = path.join(import.meta.dirname, '.env')
const examplePath = path.join(import.meta.dirname, '.env.example')
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
export const DATABASE_URL =
	process.env.DATABASE_URL ??
	`postgres://${TODOS_PG.user}:${TODOS_PG.password}@${getENV('TODOS_DB_HOST')}:${getENV('TODOS_DB_PORT')}/${TODOS_PG.database}`

/** Password for the read-only `<DbUser>` created by `<TodosSchema>`. */
export const READONLY_PASSWORD = getENV('READONLY_PASSWORD')
