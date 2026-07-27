# @db-x/sqlite-library

> ⚠️ **Experimental — do NOT use with real data.** DB-X is an early prototype:
> largely untested, unstable schema/API, breaking changes expected every
> release. Do not point it at any database you care about. Provided "AS IS",
> no warranty.
>
> **License:** MIT (the `@db-x/runtime` core it builds on is BSL 1.1). See
> [`LICENSING.md`](../../LICENSING.md).

SQLite schema components for DB-X. Built on `@db-x/runtime`, shells out to
the `sqlite3` CLI on `PATH`.

Unlike `@db-x/postgres-library`, there is no target/db split and no
creds/roles/extensions — a SQLite file **is** the database.

## Components

| Component | Purpose |
|---|---|
| `<Sqlite file protect description>` | The database file. Resolves `file` relative to the project's working directory and publishes the `sqlite3` spawn template for children. `protect` hard-locks the subtree against destructive DDL. |
| `<Table name description>` | Container for `<Column>` / `<Index>` children. Emits `CREATE TABLE` on first apply; on subsequent applies diffs against stored state and emits `RENAME COLUMN`, `ADD COLUMN`, and `DROP INDEX` for removed indexes. |
| `<Column name type primaryKey notNull unique default from description>` | A column. `from="oldName"` triggers `ALTER … RENAME COLUMN` instead of drop+add. A small case-insensitive alias map covers common cross-dialect types (see below); `serial` + `primaryKey` becomes `INTEGER PRIMARY KEY AUTOINCREMENT`. |
| `<Index name columns unique description>` | An index, idempotent via `IF NOT EXISTS`. |
| `<SeedData name sql description>` | Inline SQL. Re-runs only when `sql` changes. |

## Type aliases

`<Column type=...>` accepts SQLite's native storage classes (`TEXT`,
`INTEGER`, `REAL`, `BLOB`, `NUMERIC`) as-is, plus these case-insensitive
aliases for parity with `@db-x/postgres-library` schemas:

| Alias | SQLite type |
|---|---|
| `serial` (+ `primaryKey`) | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `serial` (no `primaryKey`) | `INTEGER` |
| `boolean` / `bool` | `INTEGER` |
| `uuid` | `TEXT` |
| `timestamptz` / `timestamp` | `TEXT` |
| `int` | `INTEGER` |
| `citext` | `TEXT` |

Anything else passes through unchanged.

## Ceiling: no `ALTER COLUMN`

SQLite cannot change a column's type, default, or `NOT NULL`-ness via
`ALTER TABLE` — that requires a create-copy-drop-rename table rebuild.
`diffTable()` throws a clear error when it detects such a change instead of
emitting invalid SQL:

```
SQLite can't ALTER COLUMN "title" on table "todos" (type change); needs a table rebuild — not supported yet.
```

Supported without a rebuild: `CREATE TABLE`, `ADD COLUMN`, `RENAME COLUMN`,
and dropping an index. The table-rebuild path is a follow-up (ponytail:
deferred — nothing in the todo demo needs it yet).

## Example

See [`examples/sqlite/dbx.tsx`](../../examples/sqlite/dbx.tsx).

## Status

`0.0.0-alpha.0`. The package builds and `diffTable` is unit tested, but no
CLI runs it end-to-end beyond the bundled example yet.
