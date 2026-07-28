# @db-x/snapshot-sqlite

A `sqlite3 .backup`-backed [`SnapshotDriver`](../runtime/src/snapshot.ts) for
DB-X — the SQLite counterpart to
[`@db-x/snapshot-pg-dump`](../snapshot-pg-dump) and
[`@db-x/snapshot-mongodump`](../snapshot-mongodump).

It captures a SQLite database to a local store directory (one `.db` copy per
snapshot plus an `index.json` manifest), and can restore, list, and prune those
snapshots. Each ref is **pinned to the state revision** it was taken from
(`.dbx/state.json`'s `lastApplied`).

Needs nothing beyond the `sqlite3` CLI that `@db-x/sqlite-library` already
requires.

## Usage

```ts
import { createSqliteDriver } from '@db-x/snapshot-sqlite'

const driver = createSqliteDriver({
  connection: {
    exec: { command: 'sqlite3', args: [] },   // as published by <Sqlite>
    file: '/abs/path/todos.db',
  },
  storeDir: '.dbx/snapshots',
})

const ref = await driver.create(state.lastApplied) // sqlite3 db ".backup snap.db"
await driver.list()                                // newest first
await driver.prune({ keepLast: 10 })               // drop older artifacts
await driver.restore(ref)                          // sqlite3 db ".restore snap.db"
```

`db-x apply` and `db-x restore` select this driver automatically — `<Sqlite>`
publishes `snapshotDriver: 'sqlite-backup'`.

## Why `.backup` and not `fs.copyFile`

The dot-commands wrap SQLite's online backup API, which takes a consistent copy
of a database that is being written to and accounts for the `-wal` / `-shm`
sidecars. Copying the file directly can capture a torn page, or silently drop
committed transactions still living in the WAL.

## Full only

There is no `schema` mode: a SQLite database *is* one file, so any copy of it
contains the rows. `mode: 'schema'` throws rather than pretending otherwise.
This makes SQLite the one engine where `db-x restore` always undoes data loss —
Postgres needs `<Postgres snapshot="full">` to match it.

## A sharp edge this driver guards

Verified against sqlite 3.x:

```sh
$ sqlite3 live.db ".restore /path/that/does/not/exist.db"
$ echo $?
0                     # success!
$ sqlite3 live.db "select count(*) from todos;"
Error: no such table: todos     # ...the database is now empty
```

`.restore` opens a missing path as a *fresh blank database* and faithfully
copies it over the target — exit 0, nothing on stderr. So `restore()` checks
the artifact exists first and throws if it doesn't. Without that, restoring a
pruned snapshot would destroy exactly the data you were trying to recover.

For the same reason the runner treats any stderr output as a failure: `.backup`
to an unwritable path does exit non-zero, but dot-command error reporting is
not consistent enough to rely on the exit code alone.
