# DB-X

> Production-grade database schema deployment with the ergonomics of a JSX
> component — plus a Time Machine for your schema and AI-reviewable changes.

> ⚠️ **Experimental — do NOT use with real data.** DB-X is an early prototype:
> largely untested, unstable schema/API, breaking changes expected every
> release. Provided "AS IS", no warranty.

Drizzle and Prisma own the application side (query DSL, types, dev migrations).
DB-X owns the **operations** side — the part that runs in CI, in production,
against a real database with users on it. You declare your schema as JSX and
`db-x apply` diffs it against live state and executes the DDL.

```tsx
/** @jsxImportSource @db-x/runtime */
import { DatabaseTarget, Postgres, Table, Column } from '@db-x/postgres-library'

export default (
  <DatabaseTarget url={process.env.DATABASE_URL}>
    <Postgres database="app">
      <Table name="todos">
        <Column name="id" type="uuid" primaryKey />
        <Column name="title" type="text" notNull />
      </Table>
    </Postgres>
  </DatabaseTarget>
)
```

```bash
db-x preview ./schema.tsx    # render JSX, diff against state, print the plan
db-x apply   ./schema.tsx    # execute the DDL, persist state
db-x destroy ./schema.tsx    # tear down in reverse order
```

## Packages

| Package | Description | License |
|---|---|---|
| [`@db-x/runtime`](./packages/runtime) | JSX runtime, `defineComponent` contract, reconciler, diff engine, state I/O | BSL-1.1 |
| [`@db-x/cli`](./packages/cli) | The `db-x` binary — preview / apply / refresh / destroy / state / describe / help | BSL-1.1 |
| [`@db-x/postgres-library`](./packages/postgres-library) | Postgres schema components: `<DatabaseTarget>`, `<Postgres>`, `<Table>`, `<Column>`, `<Index>`, `<Extension>`, `<SeedData>`, `<DbUser>` | MIT |
| [`@db-x/sqlite-library`](./packages/sqlite-library) | SQLite schema components: `<Sqlite>`, `<Table>`, `<Column>`, `<Index>`, `<SeedData>` | MIT |
| [`@db-x/snapshot-pg-dump`](./packages/snapshot-pg-dump) | `pg_dump`-based `SnapshotDriver` — pre-flight snapshots for the schema time machine | MIT |

## Development

```bash
pnpm install     # install workspace deps
pnpm build       # tsc -b — build all packages (required before the CLI runs)
pnpm test:run    # run all package tests
pnpm check       # biome lint + format check
```

Try the example after building:

```bash
cd examples/postgres
db-x preview ./dbx.tsx
```

## Layout

```
packages/runtime            @db-x/runtime            engine
packages/cli                @db-x/cli                db-x binary
packages/postgres-library   @db-x/postgres-library   schema components (Postgres)
packages/sqlite-library     @db-x/sqlite-library     schema components (SQLite)
packages/snapshot-pg-dump   @db-x/snapshot-pg-dump   pg_dump snapshot driver
apps/docs                   Docusaurus site (db-x.dev)
examples/                   runnable demo schemas (postgres, sqlite, supabase, cockroachdb)
docs/                       GOALS.md (design), large-scale.md (design note)
```

## Licensing

Two-license split: the engine (`@db-x/runtime`, `@db-x/cli`) is **BSL-1.1**; the
libraries and snapshot driver (`@db-x/postgres-library`, `@db-x/sqlite-library`,
`@db-x/snapshot-pg-dump`) are **MIT**. See [`LICENSING.md`](./LICENSING.md).
