# @db-x/postgres-library

> ⚠️ **Experimental — do NOT use with real data.** DB-X is an early prototype:
> largely untested, unstable schema/API, breaking changes expected every
> release. Do not point it at any database you care about. Provided "AS IS",
> no warranty.
>
> **License:** MIT (the `@db-x/runtime` core it builds on is BSL 1.1). See
> [`LICENSING.md`](../../LICENSING.md).

Postgres schema components for DB-X. Built on `@db-x/runtime` (which is
a thin re-export of `@db-x/runtime`).

## Components

| Component | Purpose |
|---|---|
| `<DatabaseTarget url=...>` | Production-style connection parent. Parses a `postgres://` URL and publishes a `RuntimeExec` so child components can talk to an existing DB. |
| `<Postgres user password database protect description>` | Logical database. Republishes connection metadata for children. `protect` will gate destructive changes (v0.1). |
| `<Extension name description>` | `CREATE EXTENSION IF NOT EXISTS`. |
| `<Table name description>` | Container for `<Column>` / `<Index>` children. Emits `CREATE TABLE` on first apply; on subsequent applies diffs against stored state and emits `RENAME COLUMN`, `ADD COLUMN`, `ALTER COLUMN` (type / default / NOT NULL / UNIQUE) and `DROP INDEX` for removed indexes. |
| `<Column name type primaryKey notNull unique default from description>` | A column. `from="oldName"` triggers `ALTER … RENAME COLUMN` instead of drop+add. |
| `<Index name columns unique description>` | A B-tree index, idempotent via `IF NOT EXISTS`. |
| `<SeedData name sql description>` | Inline SQL. Re-runs only when `sql` changes. |
| `<DbUser name password privileges description>` | `CREATE ROLE` + `GRANT`. Idempotent. |

## What's new vs `@db-x/postgres-library`

- **`<DatabaseTarget>`** — the missing piece for production use. Lets you
  point at an existing managed DB (RDS, Cloud SQL, a VPS) without a
  docker-compose intermediary.
- **`from="oldName"` on `<Column>`** — JSX diff can't distinguish a
  rename from drop+add. With `from`, DB-X emits a lossless
  `ALTER TABLE … RENAME COLUMN`.
- **`description` everywhere** — every component accepts a free-text
  description. Surfaced by `db-x describe` / `db-x mcp` so AI agents
  reviewing schema changes have human-written intent to read.
- **`protect` on `<Postgres>`** — flag captured (and propagated through
  state) but the CLI enforcement is a v0.1 follow-up. See the parent
  `docs/dbx/GOALS.md`.

## Migration safety (lock contention)

The `ALTER TABLE` statements the diff emits are **not** all cheap. On a live
table with traffic, be aware that Postgres takes an `ACCESS EXCLUSIVE` lock for
most `ALTER TABLE` forms — it blocks reads *and* writes for the duration:

- **`ALTER COLUMN ... TYPE`** rewrites the whole table (and its indexes) for
  most type changes, holding the lock the entire time. On a large table this
  can mean minutes of downtime. Prefer an expand/contract migration (add a new
  column, backfill, swap) for anything sizeable.
- **`SET NOT NULL`** scans the full table to validate existing rows while
  holding the lock (Postgres < 12 always; ≥ 12 can skip the scan only when a
  matching `CHECK` constraint already proves it).
- **`ADD CONSTRAINT ... UNIQUE`** builds a unique index under the lock. To avoid
  the outage, create the index `CONCURRENTLY` out of band first, then attach it.
- **`SET DEFAULT` / `DROP DEFAULT` / `DROP CONSTRAINT` / `RENAME COLUMN` /
  `DROP INDEX`** are metadata-only and fast.

DB-X applies these statements as written, in one transaction, without a
`lock_timeout`. Review the emitted SQL (via `db-x describe` / preview) before
applying against a production database, and schedule the heavy forms for a
maintenance window.

## Example

See [`examples/postgres/dbx.tsx`](../../examples/postgres/dbx.tsx).

## Status

`0.0.0-alpha.0`. The package builds and the rename + rich column/index diff
is unit tested, but no CLI runs it end-to-end yet — that lands when the
`db-x` CLI does.

## Relation to `@db-x/postgres-library`

DB-X intentionally forks the surface so it can evolve faster than the
db-x reference. Once the diff / rename / description work proves out,
the plan (per `docs/dbx/GOALS.md`) is to upstream it back so the two
plugins converge again.
