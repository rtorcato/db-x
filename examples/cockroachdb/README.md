# DB-X example — cockroachdb

> ⚠️ **Experimental — do NOT use with real data.** Points `db-x` at whatever
> `DATABASE_URL` you give it. Provided "AS IS", no warranty.

CockroachDB speaks the **Postgres wire protocol**, so it's a *connection target*
for [`@db-x/postgres-library`](../postgres) — not a new library. The same
`<DatabaseTarget url={...}>` that points at Postgres points at CockroachDB;
only the URL changes. The schema lives in [`schema.tsx`](./schema.tsx) as a
reusable `TodosSchema`; [`dbx.tsx`](./dbx.tsx) wires the connection.

The same pattern connects the other pg-compatible engines from
[#37](https://github.com/rtorcato/db-x/issues/37) — **Neon, Yugabyte, AlloyDB,
Aurora PostgreSQL, Timescale** — by swapping `DATABASE_URL`.

## Known CockroachDB deltas vs Postgres

Verified against `cockroachdb/cockroach:latest`; the schema stays inside these:

- **No `CREATE EXTENSION`.** `citext` / `pgcrypto` are unimplemented
  (`ERROR: unimplemented: extension "citext" is not yet supported`,
  `SQLSTATE 0A000`). So this example uses no `<Extension>`: `title` is plain
  `text` (not `citext`), and `gen_random_uuid()` is built in (no `pgcrypto`
  needed). `now()` / `timestamptz` behave as in Postgres.
- **Insecure single-node has no password.** `root` isn't password-protected, but
  `<Postgres>` requires a non-empty `password`, so `.env.example` passes a dummy
  the server ignores. On a secure cluster / CockroachDB Cloud, use the real one.
- **SQL port is `26257`**, not Postgres's `5432`.

## Run it

Build the workspace first (the `db-x` binary lives in `@db-x/cli`):

```sh
pnpm install && pnpm build      # from the repo root
cd examples/cockroachdb
docker compose up -d --wait     # start single-node CockroachDB (see docker-compose.yml)
pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # execute the DDL, persist state to .dbx/
pnpm destroy                    # tear it down in reverse order
docker compose down -v          # stop CockroachDB and wipe its volume
```

`preview` renders and diffs offline — it does **not** connect to a database.
`apply` shells out to `psql`, so it needs a reachable CockroachDB and `psql` on
PATH. The bundled [`docker-compose.yml`](./docker-compose.yml) provides one (SQL
on `:26257`, DB Console on http://localhost:8080); or point `DATABASE_URL` at a
CockroachDB Cloud cluster instead.

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

Snapshots go through `pg_dump`, which CockroachDB does **not** officially
support (its own equivalents are `BACKUP` / `SHOW CREATE` / `EXPORT`). Treat
rollback here as unverified — see
[#78](https://github.com/rtorcato/db-x/issues/78).

## Configuration

Connection settings live in [`.env.example`](./.env.example). `config.ts` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/cockroachdb/.env` — gitignored, your local overrides.
2. `examples/cockroachdb/.env.example` — committed demo defaults (local insecure
   single-node: `root:root@localhost:26257/todos`).

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit — e.g. paste a CockroachDB Cloud `DATABASE_URL`.
