# @db-x/mongodb-library

> ⚠️ **Experimental — do NOT use with real data.** DB-X is an early prototype:
> largely untested, unstable schema/API, breaking changes expected every
> release. Do not point it at any database you care about. Provided "AS IS",
> no warranty.
>
> **License:** MIT (the `@db-x/runtime` core it builds on is BSL 1.1). See
> [`LICENSING.md`](../../LICENSING.md).

MongoDB schema components for DB-X. Built on `@db-x/runtime`, shells out to
the `mongosh` CLI on `PATH`.

A document store has no DDL, so the `<Table>` / `<Column>` model of
`@db-x/postgres-library` does not apply ([#42](https://github.com/rtorcato/db-x/issues/42)).
What *is* declarable — and all this library manages — is:

- the **collection** itself,
- its **indexes** (`createIndex` / `dropIndex`),
- its **JSON Schema validator** (`collMod`).

Document shape is otherwise the application's business. DB-X never writes
documents except through an explicit `<SeedData>`.

## Components

| Component | Purpose |
|---|---|
| `<Mongo url database protect description>` | The database *and* the connection to it. Publishes the `mongosh` spawn template for children. `protect` hard-locks the subtree against destructive changes. |
| `<Collection name validator validationLevel validationAction description>` | Container for `<Index>` children. Creates the collection if absent; on later applies diffs against stored state and emits `collMod` / `createIndex` / `dropIndex`. |
| `<Index name keys unique partialFilterExpression expireAfterSeconds description>` | An index. `keys` is Mongo's key spec, e.g. `{ priority: 1, done: -1 }`. Idempotent when unchanged; a changed spec is dropped and rebuilt. |
| `<SeedData name js description>` | Inline mongosh JS. Re-runs only when `js` changes. |

There is no `<DatabaseTarget>` / `<Mongo>` split the way Postgres splits
connection from database: Mongo has one way in (a URI) and one tool
(`mongosh`), so a wrapper around a single implementation would be ceremony.
It splits when a second runtime parent (docker exec, ssh) actually exists.

The validator is a **prop, not a `<Validator>` child** — a collection has
exactly one, and a marker element for a single object buys nothing that
`validator={{...}}` doesn't.

## Example

```tsx
<Mongo url={process.env.MONGODB_URL} database="todos" protect>
  <Collection
    name="todos"
    validator={{
      $jsonSchema: {
        bsonType: 'object',
        required: ['title', 'done'],
        properties: { title: { bsonType: 'string' }, done: { bsonType: 'bool' } },
      },
    }}
  >
    <Index name="idx_todos_done" keys={{ done: 1 }} />
  </Collection>
</Mongo>
```

Every statement is bound to `<Mongo database>` via `getSiblingDB`, exposed to
`<SeedData js>` as `dbx`. The URI's own default database is never used to
decide where a change lands.

## Destructive changes

Flagged at plan time, so `db-x preview` marks them and `db-x apply` refuses
without `--allow-destructive` (and refuses outright under `protect`):

| Change | Why it's destructive |
|---|---|
| Dropping an index | An index rebuild can take hours on a large collection. |
| Changing an index's keys or options | Same name means drop + recreate. |
| Adding a validator where there was none | Existing documents may stop being updatable. |
| Raising `validationLevel` / `validationAction` | `moderate` → `strict`, `warn` → `error`. |
| Requiring a field the validator didn't require | Existing documents may stop being updatable. |

The validator check is a **heuristic**: it compares `required`, the level and
the action, but not property subschemas — a tightening buried inside
`properties` (a narrowed `enum`, a raised `minimum`) currently reads as
non-destructive. `protect` is the backstop until that's a real JSON Schema
subset check.

## Known gaps

- **Snapshots need the MongoDB Database Tools.** `<Mongo>` publishes
  `snapshotDriver: 'mongodump'`, so `db-x apply` captures a pre-flight snapshot
  via [`@db-x/snapshot-mongodump`](../snapshot-mongodump) before any destructive
  change, and `db-x restore` rolls it back. Both need `mongodump` and
  `mongorestore` on `PATH` — a separate install from the server and from
  `mongosh`. Mongo snapshots are always full (documents included): a
  collection's indexes and validator cannot be captured without them.
- **Credentials in `ps`.** mongosh and the database tools have no `PGPASSWORD`
  equivalent, so a URI with an inline password is visible in the process list
  while a command runs. DB-X masks it in its own logs and errors. Prefer X.509 /
  AWS IAM auth on a shared host.
- **Collections only.** No views, no time-series collections, no sharding
  keys, no users/roles.
