# DB-X TODO

Scope notes: nothing here ships to **users** until Infra-X v0.1 is out
(see the parent repo `TODO.md`). Scaffolding work that doesn't ship a
release can land in parallel.

---

## Resume here next session

1. **Land the rest of the v0.0 `<Table>` rich diff** (type / default /
   NOT NULL / UNIQUE changes; removed indexes; destructive-change
   guard). The `from=` rename + the pure `diffTable()` already shipped
   in [MR !1](https://gitlab.com/rtorcato/infra-x/-/merge_requests/1) —
   the rest is a focused extension of the same function.
2. **Stand up `packages/db-x-cli/`** as a stub. Even an `--unimplemented`
   binary that wires up `db-x preview` against `loadJsxFile` proves the
   surface and gives `examples/dbx/postgres/` a runnable smoke test.
3. **Settle the open questions** at the bottom of this file — the answers
   inform whether v0.1 work pulls from a separate site, separate scope,
   etc.

---

## v0.0 — Scaffold

Shipped in MR !1 (2026-06-10):

- [x] `packages/db-x-runtime/` — re-exports `@infra-x/runtime` so schema
  files can use `@jsxImportSource @db-x/runtime`.
- [x] `packages/db-x-postgres-library/` — fork of
  `@infra-x/postgres-library` with the DB-X-specific additions
  (`<DatabaseTarget>`, `description` everywhere, `<Column from=>`).
- [x] Npm scope decision: using `@db-x`. (Not reserved on npm yet —
  do before first publish.)
- [x] `examples/dbx/postgres/` brought into git on `main`.

Still open:

- [ ] **`packages/db-x-cli/`** — `db-x` binary, subcommand router stub.
  Even a stub that prints "unimplemented" for `apply`/`destroy` but
  actually runs `db-x preview` end-to-end against `@infra-x/runtime`'s
  `loadJsxFile` + `executePlan` (dry-run) makes `examples/dbx/postgres/` runnable.
- [ ] **Reserve `@db-x` on npm** before any package publishes.
- [x] Moved the DB-X demo into `examples/dbx/postgres/`, so it sits
  alongside the infra-x examples instead of at the repo root.
- [ ] Add a DB-X reference page or sub-section to `apps/docs/` (or stand
  up a separate `apps/docs-dbx/` — see open questions).

## v0.0 — Richer `<Table>` diff

Shipped in MR !1:

- [x] Column rename via explicit `from="oldName"` prop. JSX diff can't
  disambiguate rename from drop+add otherwise.
- [x] Pure `diffTable(name, next, priorNames)` exported so future
  `db-x preview` / `db-x mcp` can render SQL without running it.
- [x] Six unit tests in `table.test.ts` — unchanged, additions, rename,
  rename+addition ordering, and two defensive no-op cases (target
  already exists; `from` references a non-existent column).

Still open (this is the next focused chunk of work):

- [ ] Store full `ColumnSpec[]` (not just names) in `<Table>` outputs so
  the diff can compare type / default / NOT NULL / UNIQUE — currently
  `priorColumns` is a `string[]` of names only.
- [ ] Detect type / default / NOT NULL / UNIQUE changes → emit
  `ALTER COLUMN TYPE`, `SET DEFAULT`, `SET NOT NULL`, `ADD UNIQUE`.
- [ ] Store `IndexSpec[]` in outputs and detect removed indexes → emit
  `DROP INDEX IF EXISTS`.
- [ ] Surface destructive changes (`DROP COLUMN`, TYPE narrowing) in
  preview with a `!` marker; require `--allow-destructive` to apply.
  This is what wires up the `protect` prop on `<Postgres>` — currently
  captured in props but never enforced.
- [ ] Tests covering each new branch — type change, default change,
  NOT NULL toggle, dropped index, destructive guard.

## v0.1 — Schema Time Machine (snapshot + restore + history + diff)

Tier 1 of the Time Machine ladder (see `/Users/rtorcato/.claude/plans/valiant-rolling-mountain.md`).
Tier 2 — wrap managed-DB PITR — lives in v0.3. Tier 3 — self-hosted
full PITR + browse UX — is deferred to v1.0+.

- [ ] Define a `SnapshotDriver` interface
  (`create(stateRev) -> SnapshotRef`, `restore(ref)`, `list()`,
  `prune(policy)`).
- [ ] Ship `@db-x/snapshot-pg-dump`: shells out to `pg_dump --schema-only`
  by default; configurable for `--data` mode; writes to a configurable
  store (local dir → S3-compatible in v0.2).
- [ ] CLI: `db-x snapshot create [--with-data] [--label]`,
  `db-x snapshot list`, `db-x snapshot prune`, `db-x restore <id>`.
- [ ] `db-x history` — list past snapshots with timestamps and a
  one-line change summary. Read-only view of `.infrax/state.json`
  revision history joined with the snapshot manifest.
- [ ] `db-x diff <revA> <revB>` — show the SQL delta between any two
  snapshots. Reuses the pure `diffTable()` already exported from
  `@db-x/postgres-library`.
- [ ] Hook into `apply`: take a snapshot before any destructive DDL
  unless `--no-snapshot` is set. Pin the snapshot id to the state-file
  revision so `db-x restore` can find it. **This is what makes the
  `protect` flag earn its keep.**
- [ ] Document failure modes: long-running snapshots, snapshots that
  conflict with replication, snapshots on partitioned tables.

## v0.2 — Shadow-DB preview

- [ ] `db-x preview --shadow` flow:
  1. Take a `pg_dump --schema-only` of the target.
  2. Spin an ephemeral container via the existing `@infra-x/docker-library`.
  3. Restore the dump.
  4. Run the planned DDL against the shadow.
  5. Report timings, locks acquired (use `pg_locks`), errors.
  6. Tear down.
- [ ] Output formats: human-readable default, `--json` for CI consumption.
- [ ] Exit codes encode severity so CI can gate on them.

## v0.3 — MCP server (the marketing milestone)

- [ ] `@db-x/mcp` package using the official `@modelcontextprotocol/sdk`.
- [ ] Tools to expose (all read-only):
  - `describe` — full schema + state in one blob. The `description=`
    prop on every component (already shipped) is what makes this
    self-documenting.
  - `explain <resource-id>` — what depends on this table, blast radius.
  - `preview` — same as `db-x preview --shadow`, returned as a tool result.
  - `snapshot-history` — list of past snapshots with metadata.
  - `rollback-preview <id>` — what would change if we restored snapshot id.
- [ ] **Apply is NOT exposed** at v0.3. Read-only by design.
- [ ] Doc: `docs/mcp.md` — how to install in Claude Code / Cursor / Cline.

## v0.4 — Type export

- [ ] `db-x types --out <dir>` reads the live state + components and
  emits `.d.ts`.
- [ ] Second emitter target: Drizzle schema files (so Drizzle users get
  their schema regenerated from the source of truth).
- [ ] Optional: sqlc-compatible YAML schema for Go consumers.

## v1.0 — Beyond Postgres

- [ ] `@db-x/mysql-library` parity with the Postgres feature set.
- [ ] Managed-DB snapshot drivers: `@db-x/snapshot-rds`,
  `@db-x/snapshot-cloud-sql`.
- [ ] Multi-environment apply (`db-x apply --env=staging --then=prod`
  with manual gating between).
- [ ] Cost previews for snapshots (RDS snapshot costs visible in plan).

## Sunset of `@infra-x/postgres-library` and `@infra-x/mysql-library`

DB-X is meant to be the single home for database components. The
existing `@infra-x/postgres-library` and `@infra-x/mysql-library` packages
overlap with that mission and should be retired on a planned schedule
so we don't carry two parallel implementations.

`@infra-x/php-library` is unrelated — it builds PHP/WordPress Docker
images, stays in Infra-X.

Phasing:

- [ ] **Infra-X v0.1 (current target):** keep both DB libraries as-is.
  The demo examples (`examples/docker/postgres`, `examples/docker/nextjs`,
  `examples/docker/wordpress`, `examples/host/wordpress-vps`) still need them
  and there's no `db-x` CLI yet to migrate to.
- [ ] **DB-X v0.0 CLI + `@db-x/mysql-library`:** once the CLI runs and
  MySQL is at parity, migrate the demo examples one at a time to
  import from `@db-x/*`. New examples never touch the Infra-X DB
  libraries.
- [ ] **Infra-X v0.2:** mark `@infra-x/postgres-library` and
  `@infra-x/mysql-library` deprecated in their README + package.json.
  All in-repo callers must be on `@db-x/*` by this point.
- [ ] **Infra-X v0.3 / DB-X v1.0:** delete
  `packages/postgres-library/` and `packages/mysql-library/`. Single
  source of truth lives under `@db-x/*`.

## Open questions to settle before v0.1 starts

Resolved by MR !1:

- ~~Same monorepo as Infra-X, or separate?~~ → **Same.** Confirmed.
- ~~Re-export from `@infra-x/postgres-library` vs hard fork?~~ → **Hard
  fork with intent to upstream.** Confirmed by the actual code shape;
  re-export was too constraining for the API changes we needed.
- ~~Component prop API: identical to Infra-X or DB-X-flavored?~~ →
  **DB-X-flavored.** Already diverged via `<DatabaseTarget>`, `from=`,
  `description`, `protect`. The upstreaming plan brings the useful
  parts back to Infra-X rather than the other way around.

Still open:

- **Branding split:** do DB-X docs live under `docs.db-x.dev` (new) or
  under an `apps/docs-dbx/` Starlight site that shares Infra-X's
  design system? Lean: separate site, separate landing, but cross-link.
- **Release cadence:** independent `@db-x/*` semver track, or pinned
  to Infra-X minor versions? Lean: independent, since DB-X iterates
  faster on schema-specific features.

## Out of scope

- Application-layer ORM features (query DSL, connection pooling, runtime
  data access).
- Document and KV stores (Postgres + MySQL first; Redis / Mongo would
  be future libraries under a different model).
- Multi-region replication topology management.
- BI / analytics warehouse schemas (Snowflake / BigQuery).
