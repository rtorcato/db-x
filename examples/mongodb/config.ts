// Env loading + connection settings for the MongoDB todos demo. Split out of
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

/** Database the schema lands in. No hardcoded credentials — all from env. */
export const TODOS_DB = getENV('TODOS_DB_NAME')

// MONGODB_URL: set explicitly in `.env` (an Atlas `mongodb+srv://` string), or
// derived from the TODOS_DB_* parts (the local docker single node on :27017).
// The URI's own default database is irrelevant — `<Mongo database>` decides.
export const MONGODB_URL =
	process.env.MONGODB_URL ??
	`mongodb://${getENV('TODOS_DB_USER')}:${getENV('TODOS_DB_PASSWORD')}@${getENV('TODOS_DB_HOST')}:${getENV('TODOS_DB_PORT')}/?authSource=admin`
