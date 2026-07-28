# Competitive positioning & gap roadmap

> **Strategy note.** Where DB-X sits in the schema-tooling market, the honest gaps
> vs the field, and the prioritized work to close them. Read [`GOALS.md`](./GOALS.md)
> for the non-goals this note stays inside, and [`large-scale.md`](./large-scale.md)
> for the sharding / zero-downtime design detail. Tracking lives in GitHub issues,
> linked inline.

## Positioning

The market splits into an **application side** and an **operations side**:

- **Application side** — query DSL, types, dev-time migrations. Owned well by
  Drizzle, Prisma, Kysely. DB-X does not compete here and never will.
- **Operations side** — applying DDL to a live database that has users on it, in
  CI, safely. Poorly owned. **This is DB-X's wedge.**

DB-X's closest peer is **Atlas** (ariga): declarative desired-state schema, a
plan/apply flow with a diff, and destructive-change guards. DB-X's differentiators
are the **JSX authoring surface**, the **`pg_dump` "time machine"** (auto pre-flight
snapshot pinned to each state revision), and **AI-reviewable diffs** (`describe`,
and a planned MCP server). DB-X is a CLI + libraries — no daemon, meant to run in CI.

Status: `0.1.0-alpha.0`, BUSL-1.1 engine + MIT libraries, **experimental — not for
real data.** Postgres is the mature engine; SQLite is new; MySQL / SQL Server /
DuckDB are placeholders.

## Landscape

| Bucket | Tools | Where DB-X wins | Where DB-X trails today |
|---|---|---|---|
| Declarative diff | **Atlas**, Skeema, migra | JSX + time machine + AI review | Atlas is mature: linting, envs, cloud state |
| Zero-downtime DDL | **pgroll**, Reshape | — | DB-X has none of this yet ([#62](https://github.com/rtorcato/db-x/issues/62)) |
| Versioned migrations | Flyway, Liquibase, Sqitch, **Bytebase**, golang-migrate | Drift detection + snapshot; declarative not ordered-files | No DB-side lock, no rollback command, no history CLI |
| ORM engines | Prisma Migrate, **Drizzle Kit**, TypeORM | Owns prod DDL where `drizzle-kit push` is unsafe | Ceded: query DSL, types, dev migrations |
| General IaC | Terraform (pg provider), Pulumi | DB-specialized diff + guards | Not a general IaC pitch |

**Takeaway:** beat Atlas on ergonomics + time machine + AI review; beat pgroll/Reshape
by *also* doing zero-downtime DDL; beat Flyway/Liquibase/Bytebase by being declarative
with drift detection — but only once rollback, DB-side locking, and history land.

## Gap table

| Gap | Severity | Issue |
|---|---|---|
| Rollback coded (`SnapshotDriver.restore()`) but **no CLI command calls it** | High | [#58](https://github.com/rtorcato/db-x/issues/58) (child of [#6](https://github.com/rtorcato/db-x/issues/6)) |
| Destructive detection is a **fragile SQL regex** — misses `DROP POLICY`, `DETACH PARTITION`, … | High | [#59](https://github.com/rtorcato/db-x/issues/59) |
| **No DB-side lock** — local `.dbx/state.lock` only covers one working dir | High | [#60](https://github.com/rtorcato/db-x/issues/60) |
| **No transactional/atomic apply** — index creates are separate `psql -c` calls | Medium | [#61](https://github.com/rtorcato/db-x/issues/61) |
| **No lock-safe / zero-downtime DDL** — the real competitive wedge, ~0% built | High (strategic) | [#62](https://github.com/rtorcato/db-x/issues/62) |
| **No environment concept** — dev/prod is just whichever URL env vars resolve to | Medium | [#63](https://github.com/rtorcato/db-x/issues/63) (child of [#11](https://github.com/rtorcato/db-x/issues/11)) |
| No schema **linting** for unsafe-but-not-destructive changes | Medium | [#64](https://github.com/rtorcato/db-x/issues/64) |
| Docs drift: README lists 3 packages (ships 5); GOALS advertises unbuilt CLI verbs | Low | [#65](https://github.com/rtorcato/db-x/issues/65) |
| Restore / history / diff CLI (time machine) | — | [#6](https://github.com/rtorcato/db-x/issues/6) |
| MCP AI-review server | — | [#9](https://github.com/rtorcato/db-x/issues/9) |
| Multi-env / managed drivers | — | [#11](https://github.com/rtorcato/db-x/issues/11) |
| Sharding / large-scale (discussion) | — | [#47](https://github.com/rtorcato/db-x/issues/47) |

## Prioritized roadmap

Ordered by ROI — cheapest credibility wins first, the strategic wedge in the middle:

1. **Wire `db-x restore`** ([#58](https://github.com/rtorcato/db-x/issues/58)) — ~90% built and tested; unlocks the rollback story immediately.
2. **Harden destructive detection** ([#59](https://github.com/rtorcato/db-x/issues/59)) — structured classification, not regex; makes the prod guards trustworthy.
3. **Postgres advisory lock** ([#60](https://github.com/rtorcato/db-x/issues/60)) — real multi-runner CI safety.
4. **Lock-safe / zero-downtime DDL** ([#62](https://github.com/rtorcato/db-x/issues/62)) — the wedge vs pgroll/Reshape/Atlas. Highest strategic value.
5. **Dev/prod target profiles** ([#63](https://github.com/rtorcato/db-x/issues/63)) — closes the "no environment" gap.
6. **Schema linting** ([#64](https://github.com/rtorcato/db-x/issues/64)) — Atlas `migrate lint` parity; builds on #59.
7. **Transactional apply** ([#61](https://github.com/rtorcato/db-x/issues/61)) — atomic multi-step changes; coordinate with #62.
8. **History CLI** ([#6](https://github.com/rtorcato/db-x/issues/6)) and **MCP** ([#9](https://github.com/rtorcato/db-x/issues/9)) — audit trail + the AI-review differentiator.

The through-line: DB-X becomes the best prod+dev schema tool by making **apply
trustworthy** (guards, locks, rollback, linting) and then owning **zero-downtime DDL**,
which the mature declarative tools still make you reach for a separate tool to get.
