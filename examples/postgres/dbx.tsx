/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * DB-X demo — illustrates the v0.0+ API.
 *
 * What this file shows:
 *  - Production-style connection via `<DatabaseTarget url=...>` so the
 *    schema runs against an existing managed database (no docker).
 *  - `protect` on `<Postgres>`: destructive ops require
 *    `db-x apply --allow-destructive`. Snapshots auto-taken before any
 *    DROP / TYPE narrowing.
 *  - `description={...}` on every component so `db-x describe`,
 *    `db-x explain`, and the MCP server can answer "what is this and
 *    why" for an AI agent reviewing the change.
 *  - **A reusable `TodosSchema` named export** so `infra.tsx` (and
 *    any future variant — staging, CI, ephemeral) can drop the same
 *    schema into a different runtime parent without duplicating the
 *    table definitions.
 *
 * Renames via `<Column from="oldName">` are part of the API but are
 * not exercised in the default schema, because a `from=` on first
 * apply errors out (there's nothing to rename from). To demo a
 * rename, apply this file once with the current schema, then change
 * one of the column names and add `from="oldName"` — `db-x apply`
 * will emit `ALTER TABLE ... RENAME COLUMN` cleanly.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	Column,
	DatabaseTarget,
	DbUser,
	Extension,
	Index,
	Postgres,
	SeedData,
	Table,
} from '@db-x/postgres-library'
import type { Child } from '@db-x/runtime'
import { getENV } from '@rtorcato/js-common/env'
import dotenv from 'dotenv'

// First-run bootstrap: if `.env` doesn't exist, copy `.env.example` to
// `.env` so the demo runs out of the box. `.env.example` is treated as
// pure documentation — never read as config, only as a one-shot
// template. Real values live in `.env` (gitignored).
//
// Paths resolved relative to this file so it works from any cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '.env')
const examplePath = path.join(__dirname, '.env.example')
if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
	fs.copyFileSync(examplePath, envPath)
	console.error('[dbx-demo] created .env from .env.example — edit it to customize.')
}
dotenv.config({ path: envPath })

/**
 * Connection settings — read from .env / .env.example. No hardcoded
 * credentials in this file. Used by `<Postgres>` props and exported
 * for runtime parents that need to know them (e.g. an
 * `<infra-x/docker-library:Service>` setting `POSTGRES_USER`).
 */
export const TODOS_PG = {
	user: getENV('TODOS_DB_USER'),
	password: getENV('TODOS_DB_PASSWORD'),
	database: getENV('TODOS_DB_NAME'),
}

export interface TodosSchemaProps {
	/** Overrides for TODOS_PG when embedding in a different env. */
	user?: string
	password?: string
	database?: string
	/** Optional extra children rendered alongside the schema (e.g. a custom `<DbUser>` for staging). */
	children?: Child | Child[]
}

/**
 * The todos schema as a reusable component. Drop it inside any runtime
 * parent that publishes a `RuntimeExec` — `<DatabaseTarget>` for
 * production, `<Service image="postgres:...">` from
 * `@infra-x/docker-library` for local docker, etc.
 */
export function TodosSchema(props: TodosSchemaProps = {}) {
	const user = props.user ?? TODOS_PG.user
	const password = props.password ?? TODOS_PG.password
	const database = props.database ?? TODOS_PG.database
	return (
		<Postgres
			name="todos-db"
			user={user}
			password={password}
			database={database}
			protect
			description="Schema owner: todos service. Rolls back via db-x restore <id>."
		>
			<Extension name="pgcrypto" description="Used by todos.id default gen_random_uuid()" />
			<Extension name="citext" description="Case-insensitive text type for todos.title search" />

			<Table name="todos" description="User-visible todo items">
				<Column name="id" type="uuid" primaryKey default="gen_random_uuid()" />
				<Column name="title" type="citext" notNull />
				<Column name="done" type="boolean" notNull default="false" />
				<Column name="priority" type="int" notNull default="0" />
				<Column name="created_at" type="timestamptz" notNull default="now()" />

				<Index name="idx_todos_done" columns={['done']} />
				<Index name="idx_todos_created_at" columns={['created_at']} />
				<Index name="idx_todos_priority_done" columns={['priority', 'done']} />
			</Table>

			<SeedData
				name="initial-todos"
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (title, done) VALUES
            ('try the db-x demo', true),
            ('read the README', false),
            ('preview a destructive change with db-x preview --shadow', false)
          ON CONFLICT DO NOTHING
        `}
			/>

			<DbUser
				name="todos_readonly"
				password={getENV('READONLY_PASSWORD')}
				description="Used by reporting + the marketing dashboard"
				privileges={{
					database: ['CONNECT'],
					schema: ['USAGE'],
					table: ['SELECT'],
				}}
			/>
		</Postgres>
	)
}

// DATABASE_URL: either set explicitly in .env, or auto-built from the
// individual TODOS_DB_* parts above. The url is a *derivation*, not
// hardcoded credentials — every value comes from env.
const DATABASE_URL =
	process.env.DATABASE_URL ??
	`postgres://${TODOS_PG.user}:${TODOS_PG.password}@${getENV('TODOS_DB_HOST')}:${getENV('TODOS_DB_PORT')}/${TODOS_PG.database}`

/**
 * Default export — DB-X standalone, points at an existing managed
 * database via a `postgres://` URL.
 */
export default (
	<DatabaseTarget url={DATABASE_URL} description="Production todos database">
		<TodosSchema {...TODOS_PG} />
	</DatabaseTarget>
)
