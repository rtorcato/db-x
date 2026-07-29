# Changelog

All notable changes to DB-X are documented here. Versions are per-repo; each
package tracks its own version in its `package.json`.

## [Unreleased]

### Fixed

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
