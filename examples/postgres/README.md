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

## Migrate and roll back

The full loop — change the schema, see exactly what will run, apply it, and
undo it if it was wrong.

```sh
psql "$DATABASE_URL" -c "select * from todos;"   # see the data at any point

# 1. change the schema — e.g. add a column to schema.tsx, or remove an <Index>
pnpm preview                    # shows the exact statements, not a summary
pnpm apply --yes                      # run them

# 2. changed your mind? destructive changes are snapshotted first
pnpm apply --yes --allow-destructive  # captures a snapshot, then applies
pnpm restore --yes                    # roll the database back to it
```

`preview` prints the statements a change will execute, marking destructive ones
in red. `apply` refuses a destructive change unless you pass
`--allow-destructive`, and refuses again if it cannot capture a snapshot first —
so there is always something to roll back to.

Snapshots use `pg_dump`, which must be on PATH. They are **schema-only by
default** — a restore rebuilds the structure but not the rows. Set
`<Postgres snapshot="full">` in `schema.tsx` to capture data too; that dump
runs inline before the apply, so weigh it against your database size.

## Configuration

Connection settings live in [`.env.example`](./.env.example). `config.ts` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/postgres/.env` — gitignored, your local overrides.
2. `examples/postgres/.env.example` — committed demo defaults.

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit.
