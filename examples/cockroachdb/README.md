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

**Rollback is not supported on CockroachDB.** Every other example ends a
destructive change with `pnpm restore`; this one cannot, and `db-x` refuses the
change rather than pretending otherwise.

```sh
psql "$DATABASE_URL" -c "select * from todos;"   # see the data at any point

# 1. change the schema — e.g. add a column to schema.tsx, or remove an <Index>
pnpm preview                          # shows the exact statements, not a summary
pnpm apply --yes                      # run them

# 2. a destructive change stops here, by design:
pnpm apply --yes --allow-destructive
# ■ Refusing destructive changes without a snapshot: CockroachDB has no
#   snapshot driver — it speaks the Postgres wire protocol, but pg_dump fails
#   against it ("schema with OID … does not exist"), so there is no archive to
#   roll back to. Take a native BACKUP first, then re-run with --no-snapshot.
```

`preview` prints the statements a change will execute, marking destructive ones
in red. `apply` refuses a destructive change unless you pass
`--allow-destructive`, and refuses again if it cannot capture a snapshot first —
so there is always something to roll back to. On CockroachDB that second gate
never opens.

### Why, and what to do instead

`pg_dump` is not supported against CockroachDB. It does not merely produce a
questionable archive — it exits non-zero before writing anything:

```
$ pg_dump -U root -d todos --schema-only
pg_dump: error: schema with OID 105 does not exist
```

Verified against **CockroachDB v26.2.4** with **pg_dump 17.10**, on both the
demo schema and a two-column throwaway table. `psql` itself works fine, which is
why the rest of this example runs at all — it is the dump path specifically that
has no support.

So `<Postgres>` probes `select version()` on apply and, on CockroachDB, publishes
no snapshot driver at all. The alternative — tagging it `pg-dump` and hoping —
is the worst failure a safety net can have: it looks like it worked.

To make a destructive change here, take a snapshot with CockroachDB's own tools
first, then opt out of the DB-X one:

```sh
# CockroachDB's native equivalents of pg_dump:
cockroach sql --insecure -e "BACKUP DATABASE todos INTO 'nodelocal://1/todos-backup';"
# (BACKUP to local storage needs --external-io-dir or a nodelocal path)

pnpm apply --yes --allow-destructive --no-snapshot
```

A native `@db-x/snapshot-cockroachdb` driver over `BACKUP` / `SHOW CREATE` /
`EXPORT` would close this gap — not built yet.

## Configuration

Connection settings live in [`.env.example`](./.env.example). `config.ts` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/cockroachdb/.env` — gitignored, your local overrides.
2. `examples/cockroachdb/.env.example` — committed demo defaults (local insecure
   single-node: `root:root@localhost:26257/todos`).

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit — e.g. paste a CockroachDB Cloud `DATABASE_URL`.
