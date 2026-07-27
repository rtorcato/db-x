// @db-x/sqlite-library — SQLite schema components for DB-X.
//
// The file *is* the database: no separate target/db split, no creds/roles,
// no extensions. `<Sqlite file="./todos.db">` publishes the spawn template
// and file path; `<Table>/<Column>/<Index>/<SeedData>` are its children.
//
// Same `defineComponent` contract as the rest of DB-X; runtime is shared
// via `@db-x/runtime`.

export { Sqlite } from './sqlite.js'
export type { SqliteProps } from './sqlite.js'
export type { SqliteParentOutputs } from './exec.js'

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
