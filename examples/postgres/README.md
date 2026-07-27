# DB-X example — postgres

> ⚠️ **Experimental — do NOT use with real data.** Points `db-x` at whatever
> `DATABASE_URL` you give it. Provided "AS IS", no warranty.

The schema lives in [`schema.tsx`](./schema.tsx) as a reusable `TodosSchema`
component; [`dbx.tsx`](./dbx.tsx) is the entry that wires the connection around
it via `<DatabaseTarget url={...}>` and applies it against an existing Postgres.

```tsx
import { Column, Postgres, Table } from '@db-x/postgres-library';

export default (
  <Postgres name="todos-db" {...PG}>
    <Table name="todos">
      <Column name="id" type="serial" primaryKey />
      <Column name="title" type="text" notNull />
      <Column name="done" type="boolean" notNull default="false" />
    </Table>
  </Postgres>
);
```

## Run it

Build the workspace first (the `db-x` binary lives in `@db-x/cli`):

```sh
pnpm install && pnpm build      # from the repo root
cd examples/postgres
pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # execute the DDL, persist state to .dbx/
pnpm destroy                    # tear it down in reverse order
```

`preview` renders and diffs offline — it does **not** connect to a database.
`apply` shells out to `psql`, so it needs a reachable Postgres and `psql` on PATH.

## Configuration

Connection settings live in [`.env.example`](./.env.example). `dbx.tsx` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/postgres/.env` — gitignored, your local overrides.
2. `examples/postgres/.env.example` — committed demo defaults.

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit.
