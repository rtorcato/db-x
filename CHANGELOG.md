# Changelog

All notable changes to DB-X are documented here. Versions are per-repo; each
package tracks its own version in its `package.json`.

## [Unreleased]

### Fixed

- **A recreated table no longer comes back empty.** `<SeedData>` records only
  `{ name, ranAt }`, so a table that `refresh` found missing was rebuilt while
  the seed that fills it planned `no-op` — its own props and state hadn't moved,
  and the rows never returned. Components can now set
  `reapplyOnDependencyRecreate` on their spec, and the diff engine upgrades their
  `no-op` to an update when anything they `dependsOn` is being created or
  replaced. All three `<SeedData>` components opt in. Only `no-op` is upgraded
  and only a `create`/`replace` dependency triggers it, so an unchanged — or
  merely altered — dependency still re-runs nothing.

  A seed's SQL is opaque to the runtime, so it can only know what a seed is
  downstream of if you say: `<SeedData dependsOn={['table:todos']} …>`. The
  examples now declare it. Note that Postgres and MongoDB tables have no
  `refresh()` hook yet, so an out-of-band drop still goes unnoticed there until
  drift detection lands.

- **State no longer records changes that never ran.** When a diff produced no
  SQL but the props had moved, `apply` still persisted the *desired* columns
  into `outputs` — so state described a database that didn't exist, and because
  the next diff reads `outputs`, the repair it planned could never run (a
  re-added column failed with `duplicate column name`). All three libraries now
  return the last-applied shape when nothing executed. `indexes` still track the
  props: every declared index is re-created on each apply, so they are applied
  either way.

- **Dropped columns are no longer silently ignored.** `diffTable` computed
  renames, additions, alterations and dropped *indexes*, but never dropped
  *columns* — removing a `<Column>` from the JSX produced no SQL, no
  `destructive` entry and no warning, and the column survived in the database.
  Both libraries now emit `ALTER TABLE ... DROP COLUMN`, classified destructive,
  so the `--allow-destructive` gate and the pre-flight snapshot cover it. SQLite
  refuses a drop of a primary-key, `UNIQUE` or still-indexed column, so those
  fail the plan with an explicit message instead of dying mid-apply; an index
  dropped in the same edit is dropped first, which SQLite does allow.

- **Snapshot retention.** `.dbx/snapshots` grew without bound — `apply` captured
  a pre-flight snapshot before every destructive change and nothing ever removed
  one, so a whole-database copy accumulated per destructive apply. `apply` now
  prunes to the 5 most recent after a successful apply that captured one. Never
  prunes on failure, and the snapshot pinned to the current state revision is
  always among those kept, so `restore` keeps its default target.

### Added

- **Standalone repo.** Extracted DB-X from the `infra-x` monorepo into its own
  project. The runtime engine and CLI are vendored so DB-X stands alone:
  - `@db-x/runtime` (BSL-1.1) — the JSX runtime, `defineComponent` contract,
    reconciler, diff engine, and state I/O (state lives in `.dbx/`). Forked from
    `@infra-x/runtime`.
  - `@db-x/cli` (BSL-1.1) — the `db-x` binary (`preview` / `apply` / `destroy` /
    `refresh` / `state` / `describe`). Forked from `@infra-x/cli`.
  - `@db-x/postgres-library` (MIT) — Postgres schema components moved as-is.
- Docusaurus docs site under `apps/docs` (db-x.dev).
- `examples/dbx/postgres` demo, runnable via `db-x preview ./dbx.tsx`.
- Tooling scaffolded with `@rtorcato/js-tooling` (Biome, Vitest, TypeScript,
  Husky) over a pnpm workspace.
