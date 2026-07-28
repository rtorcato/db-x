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

A focused distribution on top of `@infra-x/runtime`:

1. **Components.** `<Postgres>`, `<MySQL>`, `<Table>`, `<Column>`,
   `<Index>`, `<Extension>`, `<DbUser>`, `<SeedData>` —
   shipped as `@db-x/postgres-library`, `@db-x/mysql-library`, etc.
2. **CLI.** `db-x preview | apply | destroy | snapshot | restore | history | diff | mcp | types`.
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

```
@infra-x/runtime              ← shared JSX runtime, reconciler, state
        │
        ├── @db-x/runtime              ← thin re-export + db-specific types
        ├── @db-x/postgres-library      ← <Postgres>, <Table>, <Column>, …
        ├── @db-x/mysql-library         ← parallel for MySQL
        ├── @db-x/snapshot-pg-dump     ← pg_dump driver
        ├── @db-x/snapshot-rds         ← AWS RDS snapshot driver
        ├── @db-x/mcp                  ← MCP server
        ├── @db-x/types-export         ← schema → .d.ts / Drizzle / sqlc
        └── @db-x/cli                  ← `db-x` binary
```

Lives **in the same monorepo as Infra-X** as `packages/db-x-*/`. Same
pnpm workspace, separate npm scope, separate release cadence.

### When to split DB-X into its own repo

Stay in the monorepo until **all three** triggers fire. Don't re-litigate
this decision on intuition alone — they're listed here so future-us has
a checklist.

1. **`@infra-x/runtime@1.0` is published** with a frozen `defineComponent`
   contract. Splitting before that means coordinating breaking changes
   across two repos every time the runtime moves.
2. **DB-X has demonstrable external usage** — issues from outside
   contributors, non-trivial GitHub stars, a paying user or sponsor.
   Splitting an unused product just doubles the maintenance surface.
3. **Release coordination is the real bottleneck.** If we keep wanting to
   ship DB-X without an Infra-X release (or vice versa) and the monorepo
   is what's blocking it, that's the signal.

Interim boundary hygiene that does *not* require a split:

- Separate npm scope (`@db-x/*`) — already done.
- Separate CLI binary (`db-x`) — tracked in the [v0.0 milestone](https://github.com/rtorcato/db-x/milestones).
- Separate Docusaurus docs site at `apps/dbx-docs/` — already scaffolded;
  deploy workflow is parked on a fix branch.
- Separate milestone series on GitHub (`dbx-v0.0`, `dbx-v0.1`, …) tagged
  with `area:dbx`.
- Separate `CHANGELOG.md` per scope.

## Relationship to Infra-X

- DB-X depends on `@infra-x/runtime` but **Infra-X never depends on
  DB-X**. The dependency points one way.
- Components are reusable in both directions: an Infra-X user can drop
  `<Table>` from `@db-x/postgres-library` inside an `<Infra>` tree and
  get DB-X's richer features without switching CLIs.
- The `db-x` CLI never exposes Infra-X's general-purpose `apply` for
  arbitrary resource types — it's scoped to DB resources. Conversely
  Infra-X's CLI doesn't expose `db-x snapshot` / `db-x restore`.

## Sequencing

The shipping order and every task live in
[GitHub milestones](https://github.com/rtorcato/db-x/milestones) (`v0.0 — Scaffold + rich
diff` → `v1.1 — More SQL engines`) and their issues — that's the single source of truth.
**No package starts before Infra-X v0.1 is out**; DB-X depends on a stable runtime
contract.

## How we'll know it worked

- A team that uses Drizzle in production replaces drizzle-kit push with
  `db-x apply` in their CI pipeline.
- A PR-review tool (Claude / Cursor) can answer "is this schema change
  safe to merge?" by talking to `db-x mcp` against the real DB.
- An on-call engineer rolls back a bad schema deploy with one command
  in under 60 seconds.
