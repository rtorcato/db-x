// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<Sqlite>` — the file *is* the database, so unlike Postgres there is no
// separate target/db split and no creds/roles. `<Sqlite>` both owns the
// spawn template (`sqlite3`) and resolves the file path; children
// (`<Table>`, `<SeedData>`) read both via `ctx.deps[parentId]`.

import path from 'node:path'
import { type PlanAction, defineComponent } from '@db-x/runtime'
import type { SqliteParentOutputs } from './exec.js'

export interface SqliteProps {
	/** Logical name. Used only to derive the resource id (`sqlite:<name>`). */
	name?: string
	/** Path to the `.db` file, resolved relative to the project's `workDir` if not absolute. */
	file: string
	/**
	 * Hard-lock this database's subtree against destructive DDL. When set,
	 * `db-x apply` refuses any destructive change (DROP, table rebuild, …) on
	 * this `<Sqlite>` or its children **even with** `--allow-destructive` —
	 * you must remove `protect` from the JSX to proceed.
	 *
	 * Enforced by the runtime destructive guard (see `findDestructiveViolations`).
	 */
	protect?: boolean
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export const Sqlite = defineComponent<SqliteProps, SqliteParentOutputs>({
	kind: '@db-x/sqlite-library:sqlite',
	apply: async (props, ctx) => {
		// `ctx.workDir` is the `.dbx/` scratch directory itself (see `Ctx.workDir`
		// in @db-x/runtime), not the project root — resolve relative paths
		// against its parent so `file="./todos.db"` lands next to `dbx.tsx`,
		// not inside `.dbx/`.
		const projectRoot = path.dirname(ctx.workDir)
		const file = path.isAbsolute(props.file) ? props.file : path.join(projectRoot, props.file)

		ctx.log.info(`Sqlite ready (file=${file}${props.protect ? ', protect=on' : ''})`)

		return {
			file,
			// Direct spawn, no wrapper — sqlite3 is a single self-contained
			// binary, unlike psql/pg_dump which differ by child tool.
			exec: { command: 'sqlite3', args: [] },
		}
	},
	destroy: async (state, ctx) => {
		// We never delete the database file itself — only the objects inside
		// it (tables, indexes) that each component owns.
		ctx.log.info(`Sqlite ${state.outputs.file}: no-op destroy (file not owned)`)
	},
	plan: (props, state): PlanAction => {
		if (!state) return { type: 'create' }
		return JSON.stringify(props) === JSON.stringify(state.props)
			? { type: 'no-op' }
			: { type: 'update', reason: 'props changed' }
	},
})
