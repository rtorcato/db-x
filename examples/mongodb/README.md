# DB-X example — mongodb

> ⚠️ **Experimental — do NOT use with real data.** Points `db-x` at whatever
> `MONGODB_URL` you give it. Provided "AS IS", no warranty.

MongoDB is a **document store**, so this example does not mirror
[`examples/postgres/`](../postgres/): there is no `<Table>`, no `<Column>`, and
no DDL. What DB-X manages is the collection, its indexes, and its JSON Schema
validator — see [`@db-x/mongodb-library`](../../packages/mongodb-library).

The schema lives in [`schema.tsx`](./schema.tsx) as a reusable `TodosSchema`;
[`dbx.tsx`](./dbx.tsx) wires the connection.

## What's different from the SQL examples

- **No target/database split.** `<Mongo url database>` is both
  `<DatabaseTarget>` and `<Postgres>`. One URI, one tool (`mongosh`).
- **The validator replaces the column list.** `NOT NULL` and type constraints
  become a `$jsonSchema` validator applied with `collMod`. Existing documents
  keep their shape — the validator only constrains writes.
- **Seeds are JS, not SQL.** Mongo has no `ON CONFLICT DO NOTHING`, so
  `<SeedData js>` uses `updateOne(..., { upsert: true })` for idempotency.
- **Explicit database binding.** Every statement runs against
  `getSiblingDB(<Mongo database>)`, exposed as `dbx`. The URI's default
  database is never what decides where a change lands.

## Run it

Build the workspace first (the `db-x` binary lives in `@db-x/cli`):

```sh
pnpm install && pnpm build      # from the repo root
cd examples/mongodb
docker compose up -d --wait     # start single-node MongoDB (see docker-compose.yml)
pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # create the collection + indexes, persist state to .dbx/
pnpm destroy                    # drop the collection
docker compose down -v          # stop MongoDB and wipe its volume
```

`preview` renders and diffs offline — it does **not** connect to a database.
`apply` shells out to `mongosh`, so it needs a reachable MongoDB **and
`mongosh` on PATH** (it does not ship with the server; install
[mongosh](https://www.mongodb.com/docs/mongodb-shell/install/) separately).
The bundled [`docker-compose.yml`](./docker-compose.yml) provides the server on
`:27017`; or point `MONGODB_URL` at an Atlas cluster instead.

## Known limitations

- **Snapshots need `mongodump` / `mongorestore` on PATH.** Dropping an index or
  tightening the validator is a destructive change, so `db-x apply` captures a
  pre-flight snapshot first (via
  [`@db-x/snapshot-mongodump`](../../packages/snapshot-mongodump)) and
  `db-x restore` rolls it back. The
  [Database Tools](https://www.mongodb.com/docs/database-tools/) are a separate
  install from the server and from `mongosh`. Note the `<Mongo protect>` in
  `schema.tsx` blocks destructive changes regardless — remove it from the JSX to
  proceed.
- **Credentials appear in `ps`.** mongosh has no `PGPASSWORD` equivalent. DB-X
  masks the password in its own output only.

## Configuration

Connection settings live in [`.env.example`](./.env.example). `config.ts` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/mongodb/.env` — gitignored, your local overrides.
2. `examples/mongodb/.env.example` — committed demo defaults (local docker
   single node: `todos:todos@localhost:27017`, `?authSource=admin`).

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit — e.g. paste an Atlas `MONGODB_URL`.
