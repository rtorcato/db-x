// Env loading for the SQLite todos demo. Split out of `dbx.tsx` so the entry
// file is nothing but the component tree — the JSX is what the example is
// teaching; dotenv plumbing is not.

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

// First-run bootstrap: if `.env` doesn't exist, copy `.env.example` to `.env`
// so the demo runs out of the box. Paths resolved relative to this file so it
// works from any cwd — `import.meta.dirname` needs Node 20.11+, and the repo
// requires 22.
const envPath = path.join(import.meta.dirname, '.env')
const examplePath = path.join(import.meta.dirname, '.env.example')
if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
	fs.copyFileSync(examplePath, envPath)
	console.error('[dbx-demo] created .env from .env.example — edit it to customize.')
}
dotenv.config({ path: envPath })

/** Where the database file lives. The demo runs with no `.env` at all. */
export const SQLITE_FILE = process.env.SQLITE_FILE ?? './todos.db'
