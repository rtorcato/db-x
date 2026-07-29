# DB-X example — sqlite

> ⚠️ **Experimental — do NOT use with real data.** Applies `db-x` against a
> local SQLite file. Provided "AS IS", no warranty.

[`dbx.tsx`](./dbx.tsx) wraps the [`TodosSchema`](./schema.tsx) in a
`<Sqlite file={...}>` — the file *is* the database, so there's no connection
URL, credentials, or docker step.

```tsx
import { Column, Sqlite, Table } from '@db-x/sqlite-library';

export default (
  <Sqlite name="todos-db" file="./todos.db">
    <Table name="todos">
      <Column name="id" type="integer" primaryKey />
      <Column name="title" type="text" notNull />
      <Column name="done" type="integer" notNull default="0" />
    </Table>
  </Sqlite>
);
```

## Run it

Build the workspace first (the `db-x` binary lives in `@db-x/cli`):

```sh
pnpm install && pnpm build      # from the repo root
cd examples/sqlite
pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # execute the DDL, persist state to .dbx/
pnpm destroy                    # tear it down in reverse order
```

`preview` renders and diffs offline — it does **not** touch the database file.
`apply` shells out to `sqlite3`, so it needs `sqlite3` on `PATH`.

## Migrate and roll back

The full loop — change the schema, see exactly what will run, apply it, and
undo it if it was wrong.

```sh
sqlite3 todos.db "select * from todos;"   # see the data at any point

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

Snapshots are whole-file copies via `sqlite3 .backup`, so a restore brings back
**both** the schema and the rows. Nothing extra to install.

## When the database and the state disagree

`.dbx/state.json` records what DB-X last applied. If the database changes
behind its back — you delete `todos.db`, or someone drops a column by hand —
state still describes the old world, and `preview` will report no changes
because it has no reason to think otherwise.

`db-x refresh` is what closes that gap: it reads the live database and writes
what it finds back into state, so the next `preview` plans the repair.

```sh
sqlite3 todos.db "alter table todos drop column priority;"   # out-of-band change

pnpm exec db-x refresh             # ~ table:todos  drift: columns
pnpm preview                       # → ALTER TABLE "todos" ADD COLUMN "priority" ...
pnpm apply --yes                   # column restored
```

Delete `todos.db` entirely and the same loop rebuilds the schema — refresh sees
no columns, so the plan becomes a `create` rather than a doomed `ALTER`.

Two limits worth knowing:

- **Seeds do not re-run.** `<SeedData>` has no refresh hook, so a rebuilt table
  comes back empty. Delete `.dbx/` and re-apply for a true from-scratch run.
- **Only column and index *names* are compared.** A changed type, default or
  nullability is not detected as drift yet.

## Configuration

[`.env.example`](./.env.example) sets `SQLITE_FILE` — the only setting this
example has. Copy it to `.env` to customize; `.env` is gitignored.
