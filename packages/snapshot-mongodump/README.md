# @db-x/snapshot-mongodump

A `mongodump`-backed [`SnapshotDriver`](../runtime/src/snapshot.ts) for DB-X —
the MongoDB counterpart to [`@db-x/snapshot-pg-dump`](../snapshot-pg-dump)
(issue #78).

It captures a MongoDB database to a local store directory (one gzipped archive
per snapshot plus an `index.json` manifest), and can restore, list, and prune
those snapshots. Each snapshot ref is **pinned to the state revision** it was
taken from (`.dbx/state.json`'s `lastApplied`), so a snapshot can be linked back
to the exact applied state it rolls back to.

Requires `mongodump` and `mongorestore` on `PATH` — they ship in
[MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/), which is
a separate install from the server and from `mongosh`.

## Usage

```ts
import { createMongodumpDriver } from '@db-x/snapshot-mongodump'

const driver = createMongodumpDriver({
  connection: {
    // Same spawn indirection <Mongo> uses — direct, docker exec, or ssh.
    // A wrapper prefix, not the tool: the driver appends mongodump/mongorestore.
    exec: { command: 'docker', args: ['compose', 'exec', '-T', 'mongodb'] },
    uri: process.env.MONGODB_URL ?? '',
    database: 'todos',
  },
  storeDir: '.dbx/snapshots',
})

const ref = await driver.create(state.lastApplied) // mongodump --archive --gzip
await driver.list()                                // newest first
await driver.prune({ keepLast: 10 })               // drop older artifacts
await driver.restore(ref)                          // mongorestore --drop < archive
```

`db-x apply` and `db-x restore` select this driver automatically when the
database component publishes `snapshotDriver: 'mongodump'` — see
`packages/cli/src/snapshot.ts`.

## Differences from the pg_dump driver

| | `snapshot-pg-dump` | `snapshot-mongodump` |
|---|---|---|
| Artifact | `.sql` text | `.archive.gz` (gzipped mongodump archive) |
| Modes | `schema` (default) / `full` | **`full` only** |
| Credentials | `PGPASSWORD` in child env | inline in the `--uri` argument |

**No schema-only mode.** A Mongo collection's "schema" is its indexes and
validator, and `mongodump` cannot capture those without the documents. Passing
`mode: 'schema'` throws rather than silently capturing data the caller didn't
ask for.

**Credentials are visible in `ps`.** The database tools have no `PGPASSWORD`
equivalent, so a URI with an inline password must go in argv. The driver masks
it in its own error output (`redact()`), which is all it can do — prefer X.509
or AWS IAM auth on a shared host.

**`--drop` is per-collection.** `restore` drops each collection *present in the
archive* before restoring it, so a collection created *after* the snapshot
survives the restore. Same non-clean semantics as the pg_dump driver.

## Scope

- Local-directory store. S3 and other backends come later behind the same interface.
- `prune({ keepLast })` retention. Richer policies (age, tags) later.
- Restores into the same database name the snapshot came from
  (`--nsInclude=<db>.*`). Cross-database restore would need `--nsFrom`/`--nsTo`.
