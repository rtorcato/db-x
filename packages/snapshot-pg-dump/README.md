# @db-x/snapshot-pg-dump

A `pg_dump`-backed [`SnapshotDriver`](../runtime/src/snapshot.ts) for DB-X — the
reference implementation of the schema **Time Machine** foundation (issue #5).

It captures a Postgres database to a local store directory (one `.sql` artifact
per snapshot plus an `index.json` manifest), and can restore, list, and prune
those snapshots. Each snapshot ref is **pinned to the state revision** it was
taken from (`.dbx/state.json`'s `lastApplied`), so a snapshot can be linked back
to the exact applied state it rolls back to.

## Usage

```ts
import { createPgDumpDriver } from '@db-x/snapshot-pg-dump'

const driver = createPgDumpDriver({
  connection: {
    // Same spawn indirection <Postgres> uses — docker exec, ssh, or direct.
    exec: { command: 'docker', args: ['compose', 'exec', '-T', 'db'] },
    user: 'app',
    password: process.env.PGPASSWORD ?? '',
    database: 'appdb',
  },
  storeDir: '.dbx/snapshots',
  mode: 'schema', // default; 'full' includes row data
})

const ref = await driver.create(state.lastApplied) // pg_dump --schema-only
await driver.list()                                // newest first
await driver.prune({ keepLast: 10 })               // drop older artifacts
await driver.restore(ref)                          // psql < artifact
```

The password is passed via `PGPASSWORD` in the child env, never on the command
line. The database is reached through the `exec` spawn template, so the driver
works whether Postgres is a docker `compose exec`, an `ssh` host, or local.

## Scope (v0.1)

- Local-directory store. S3 and other backends come later behind the same interface.
- `schema` / `full` capture modes.
- `prune({ keepLast })` retention. Richer policies (age, tags) later.

Snapshot/restore/history **CLI** commands are issue #6; auto-snapshot before
destructive DDL on `apply` is issue #7 — both build on this driver.
