# DB-X Goals

> **This is the design / vision doc — the *why*, the positioning, and the non-goals.**
> The *roadmap and tasks* live in [GitHub milestones](https://github.com/rtorcato/db-x/milestones)
> and issues, not here. Large-scale / sharding design lives in [`large-scale.md`](./large-scale.md).
> Competitive positioning and the gap-closing roadmap live in [`competition.md`](./competition.md).

## North star

> **Make production-grade database schema deployment as ergonomic as
> writing a JSX component — with a Time Machine for your schema and
> AI review built in.**

Drizzle and Prisma own the application-side experience (query DSL,
types, dev migrations). Nobody owns the *operations* side well — the
part that runs in CI, in production, against a real database with users
on it. That's the wedge.

## What we're building

A focused distribution on top of `@db-x/runtime`:

1. **Components.** `<Postgres>`, `<MySQL>`, `<Table>`, `<Column>`,
   `<Index>`, `<Extension>`, `<DbUser>`, `<SeedData>` —
   shipped as `@db-x/postgres-library`, `@db-x/mysql-library`, etc.
2. **CLI.** Shipped today: `db-x preview | apply | refresh | destroy | restore | state | describe | help`.
   Planned: `snapshot | history | diff` (rest of the time machine, [#6](https://github.com/rtorcato/db-x/issues/6)),
   `mcp` ([#9](https://github.com/rtorcato/db-x/issues/9)), `types` ([#10](https://github.com/rtorcato/db-x/issues/10)).
3. **Snapshot driver.** Pluggable: `pg_dump` for self-hosted Postgres,
   RDS / Cloud SQL snapshot APIs for managed.
4. **Shadow-DB preview.** Spin an ephemeral copy, dry-run the DDL,
   report timings + locks before the real apply.
5. **MCP server.** Exposes `describe`/`explain`/`graph`/`preview` as
   tools so AI agents can reason about schema changes.
6. **Type export.** From the live schema, emit `.d.ts` (and optionally
   Drizzle / sqlc schema files) so application code stays in sync.

## The wedge — five things no migration tool ships today

| Capability | Drizzle / Flyway | Prisma | DB-X |
|---|---|---|---|
| Declarative schema | DSL | PSL | **JSX** |
| Time Machine for schema | — | — | **snapshot + restore + history + diff** |
| Plan / preview before apply | — | — | **shadow-DB + lock report** |
| AI-reviewable diff | — | — | **MCP server** |
| Schema → ORM types | manual | built-in (for Prisma) | **export for any ORM** |

A miss on any one isn't fatal; together they are the pitch.

## Audience

- **Primary:** application engineering teams that already use Drizzle /
  Prisma / Kysely and currently deploy schema changes by hand,
  drizzle-kit push, or Flyway. They want a CI-safe gate with rollback.
- **Secondary:** Infra-X users who want richer DB tooling than the
  reference `@infra-x/postgres-library` and prefer the focused `db-x`
  CLI.
- **Not:** greenfield solo devs running migrations from their laptop —
  Drizzle is great for them; we don't displace it.

## Non-goals

- **No ORM.** No query DSL, no runtime data-access helpers, no
  connection pool. We do not compete with Drizzle's query layer or
  Prisma Client.
- **No data migrations as a first-class concept.** Schema only.
  Backfills happen via explicit `<SeedData>` or your ORM's scripts;
  we don't model them.
- **No cross-database schema diffs.** v0.x targets one database per
  apply tree.
- **No new IaC pitch.** DB-X is not "Terraform for databases" — it's a
  focused tool on top of an existing runtime. The general-purpose IaC
  story belongs to Infra-X.

## Architecture sketch

Shipped:

```
@db-x/runtime              ← JSX runtime, reconciler, diff engine, state I/O
        │
        ├── @db-x/postgres-library     ← <DatabaseTarget>, <Postgres>, <Table>, <Column>, …
        ├── @db-x/sqlite-library       ← <Sqlite>, <Table>, <Column>, <Index>, <SeedData>
        ├── @db-x/mongodb-library      ← <Mongo>, <Collection>, <Index>, <SeedData>
        ├── @db-x/snapshot-pg-dump     ← pg_dump SnapshotDriver
        ├── @db-x/snapshot-mongodump   ← mongodump SnapshotDriver
        ├── @db-x/snapshot-sqlite      ← sqlite3 .backup SnapshotDriver
        └── @db-x/cli                  ← `db-x` binary
```

Planned, each tracked by an issue:

```
@db-x/mysql-library      #12    @db-x/snapshot-cockroachdb  #109
@db-x/sqlserver-library  #29    @db-x/snapshot-sqlserver    #32
@db-x/duckdb-library     #30    @db-x/snapshot-duckdb       #33
@db-x/mcp                #9     @db-x/types-export          #10
```

Lives in its own repository, `rtorcato/db-x`. The split from the Infra-X
monorepo is done; the runtime is vendored, so there is no `@infra-x`
dependency in the tree.

## Relationship to Infra-X

DB-X began as a fork of Infra-X and has since vendored the runtime. The
two projects share no code path and release independently — **there is no
`@infra-x` dependency**, in either direction.

What carried over is the model, not the package: the same
`defineComponent` contract, the same phase ordering, the same state shape.
A component written against `@db-x/runtime` is not loadable by Infra-X's
CLI, and vice versa; keeping the contracts aligned is a convention, not a
guarantee.

The `db-x` binary stays scoped to database resources and never exposes a
general-purpose `apply` for arbitrary resource types.

## Sequencing

The shipping order and every task live in
[GitHub milestones](https://github.com/rtorcato/db-x/milestones) (`v0.0 — Scaffold + rich
diff` → `v1.1 — More SQL engines`) and their issues — that's the single source of truth.

## How we'll know it worked

- A team that uses Drizzle in production replaces drizzle-kit push with
  `db-x apply` in their CI pipeline.
- A PR-review tool (Claude / Cursor) can answer "is this schema change
  safe to merge?" by talking to `db-x mcp` against the real DB.
- An on-call engineer rolls back a bad schema deploy with one command
  in under 60 seconds.
