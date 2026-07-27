// @db-x/postgres-library — Postgres schema components for DB-X.
//
// Compared to @db-x/postgres-library this package adds:
//   - <DatabaseTarget url=...> — connect to an existing (production)
//     database without standing one up via docker.
//   - `description` on every component for AI-readable schema review.
//   - `from="oldName"` on <Column> for explicit, lossless renames.
//   - `protect` on <Postgres> — hard-locks the subtree against destructive
//     DDL, enforced by the runtime guard (see findDestructiveViolations).
//
// Same `defineComponent` contract as DB-X; runtime is shared via
// @db-x/runtime → @db-x/runtime.

export { DatabaseTarget } from './target.js'
export type { DatabaseTargetProps, DatabaseTargetOutputs } from './target.js'

export { Postgres, pgUrl } from './postgres.js'
export type { PostgresProps, PostgresState } from './postgres.js'

export { Extension } from './extension.js'
export type { ExtensionProps, ExtensionOutputs } from './extension.js'

export {
	Column,
	Index,
	Table,
	buildCreateTable,
	buildCreateIndex,
	columnSql,
	diffTable,
} from './table.js'
export type { ColumnSpec, IndexSpec, TableProps, TableDiff } from './table.js'

export { SeedData } from './seed.js'
export type { SeedDataProps, SeedDataOutputs } from './seed.js'

export { DbUser } from './user.js'
export type { DbUserPrivileges, DbUserProps, DbUserOutputs } from './user.js'
