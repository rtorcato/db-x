# Large-scale deployments: sharding & advanced features

> **Design note, not a roadmap.** This records *how* large-scale techniques map onto
> DB-X's layer and *where* they rank. None of it is committed work — tracking lives in
> [GitHub milestones](https://github.com/rtorcato/db-x/milestones) and issues (see
> [#47](https://github.com/rtorcato/db-x/issues/47)). Read [`GOALS.md`](./GOALS.md) first
> for the non-goals this note stays inside, and [`competition.md`](./competition.md)
> for how zero-downtime DDL ranks against the rest of the competitive roadmap.

## How sharding actually maps onto DB-X

**DB-X never builds a shard router.** Query routing, connection pooling, and shard-key
dispatch are runtime data-access concerns — explicit non-goals ("no connection pool, no
runtime data access", `GOALS.md`). In Postgres, "sharding" reduces to **DDL DB-X can
declare, diff, and apply**, which is DB-X's entire job. Three mechanisms, ascending scope:

1. **Native declarative partitioning** (single server). `CREATE TABLE … PARTITION BY
   RANGE/LIST/HASH` + child `PARTITION OF … FOR VALUES`. Pure schema DDL, fully in-lane —
   just new props on `<Table>` + a `<Partition>` component.
2. **Citus / distributed tables** (multi-node). Expressed as SQL functions —
   `SELECT create_distributed_table('t','key')`, `create_reference_table(...)`,
   `colocate_with`. Still declarative DDL: DB-X declares the distribution; **Citus's
   coordinator does the runtime routing.** A `<DistributedTable>` component. Stays inside
   the non-goals.
3. **Multi-target fan-out** (one schema tree → N shard databases). The only true
   "orchestration" piece, and it **conflicts with the v0.x non-goal** "no cross-database
   schema diffs — v0.x targets one database per apply tree". The code is single-target
   today (one `<DatabaseTarget>` → one URL → one exec; no fan-out in the executor). So
   this is **post-v0.x**, sharing machinery with the deferred v1.0 multi-environment apply.

**A "sharding plan" is really a partitioning + Citus-component plan plus deferred
multi-target fan-out — not a sharding engine. No router, ever.**

## Ranked large-scale features (sharding is #4, not #1)

Ranked by value to DB-X's stated audience ("a real database with users on it") ×
in-lane-ness:

1. **Lock-safe / zero-downtime DDL — the real wedge, ~0% built today.**
   `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT … NOT VALID` → `VALIDATE`,
   `lock_timeout`/`statement_timeout` guards, avoiding table-rewriting `ALTER`s and long
   `ACCESS EXCLUSIVE` locks. `GOALS.md` already promises a shadow-DB "lock report" (v0.2) —
   the natural extension is to *generate* lock-safe DDL, not just report locks. Indexes are
   plain `CREATE INDEX IF NOT EXISTS` today. **Higher ROI than sharding.**
2. **Native declarative partitioning** (above, item 1) — unblocks big tables without
   touching the query layer.
3. **Multi-tenant schema fan-out** (schema/db-per-tenant) — same machinery as shard
   fan-out, post-v0.x; the *more common* real-world driver than true horizontal sharding.
4. **Sharding via Citus distributed-table components** (above, item 2).
5. **Row-level security** (a `<Policy>` component) + richer indexes (partial / covering /
   `USING` method — currently hardcoded btree).

**Explicitly NOT DB-X's lane:** connection pooling (only need to *tolerate* a pooler),
read-replica / replication topology (replica-aware for snapshots only), query routing,
data backfills ("no data migrations as a first-class concept").

## Two safety landmines for whoever builds any of this

- Destructiveness is a **regex over emitted SQL** (`isDestructiveSql` in
  `packages/postgres-library/src/table.tsx`). Every new verb (`DROP POLICY`,
  `DETACH PARTITION`, distribution changes) must be taught to it or it silently bypasses
  the `protect` / `--allow-destructive` guard (`packages/runtime/src/guard.ts`).
- `CREATE INDEX CONCURRENTLY` **cannot run inside the batched `sql.join(';\n')`**
  multi-statement exec (`table.tsx`). Lock-safe DDL requires per-statement execution — a
  real apply-path change, not a prop add.

**Bottom line:** if large-scale support is ever built, the first thing should be
**lock-safe DDL**, not sharding.
