# DB-X example — postgres

> ⚠️ **Experimental — do NOT use with real data.** Points `db-x` at whatever
> `DATABASE_URL` you give it. Provided "AS IS", no warranty.

[`dbx.tsx`](./dbx.tsx) declares a `todos` schema and applies it production-direct
via `<DatabaseTarget url={...}>` against an existing Postgres database.

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
docker compose up -d --wait     # start a plain Postgres (see docker-compose.yml)
pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # execute the DDL, persist state to .dbx/
pnpm destroy                    # tear it down in reverse order
docker compose down -v          # stop Postgres and wipe its volume
```

`preview` renders and diffs offline — it does **not** connect to a database.
`apply` shells out to `psql`, so it needs a reachable Postgres and `psql` on PATH.
The bundled [`docker-compose.yml`](./docker-compose.yml) provides one with no
Infra-X involved; or point `DATABASE_URL` at any existing Postgres instead.

## Configuration

Connection settings live in [`.env.example`](./.env.example). `dbx.tsx` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/postgres/.env` — gitignored, your local overrides.
2. `examples/postgres/.env.example` — committed demo defaults.

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit.
