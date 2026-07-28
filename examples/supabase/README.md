# DB-X example — supabase

> ⚠️ **Experimental — do NOT use with real data.** Points `db-x` at whatever
> `DATABASE_URL` you give it. Provided "AS IS", no warranty.

Supabase is hosted Postgres, so the plain-postgres [`@db-x/postgres-library`](../postgres)
components apply unchanged — this example just adds the two things that make a
schema *Supabase*:

- `todos.user_id` references Supabase's managed `auth.users(id)`.
- **Row Level Security** with an owner-only policy keyed on `auth.uid()`.

There's no dedicated foreign-key or policy component, so those go through a
`<SeedData>` block of idempotent raw SQL in [`schema.tsx`](./schema.tsx).
[`dbx.tsx`](./dbx.tsx) is the entry that wires the connection via
`<DatabaseTarget url={...}>`.

```tsx
<Table name="todos">
  <Column name="id" type="uuid" primaryKey default="gen_random_uuid()" />
  <Column name="user_id" type="uuid" notNull />
  <Column name="title" type="citext" notNull />
</Table>

<SeedData name="rls-and-ownership" sql={`
  ALTER TABLE todos ADD CONSTRAINT todos_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users manage their own todos" ON todos
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
`} />
```

## Run it

Build the workspace first (the `db-x` binary lives in `@db-x/cli`):

```sh
pnpm install && pnpm build      # from the repo root
cd examples/supabase

# Local Supabase stack — needs the Supabase CLI + a running Docker.
brew install supabase/tap/supabase   # or: https://supabase.com/docs/guides/cli
supabase init                        # creates ./supabase/config.toml (once)
supabase start                       # boots Postgres :54322 + auth/API/Studio

pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # execute the DDL, persist state to .dbx/
pnpm destroy                    # tear it down in reverse order
supabase stop                   # stop the stack (add --no-backup to wipe data)
```

`preview` renders and diffs offline — it does **not** connect to a database.
`apply` shells out to `psql`, so it needs a reachable Postgres and `psql` on
PATH. `supabase start` boots the full stack in Docker; GoTrue provisions the
`auth` schema and `auth.users` table on startup (which `schema.tsx`'s FK
references), and exposes Postgres at the `.env.example` defaults
(`postgres:postgres@127.0.0.1:54322/postgres`). `supabase init` is required
first — `supabase start` fails without a `supabase/config.toml`. Alternatively,
skip Supabase locally and point `DATABASE_URL` at a hosted project's **direct
connection** string (Project Settings → Database — the `:5432` direct one, not
the `:6543` pooler, which mishandles session-level DDL).

The demo seeds no rows: `todos.user_id` is NOT NULL and references `auth.users`,
so a row needs a real user. After `apply`, create one and insert:

```sql
-- against the same DB (e.g. `supabase db` or psql)
select id from auth.users limit 1;  -- grab a real user id
insert into todos (user_id, title) values ('<that-id>', 'try the db-x supabase demo');
```

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
pnpm exec db-x restore --yes                    # roll the database back to it
```

`preview` prints the statements a change will execute, marking destructive ones
in red. `apply` refuses a destructive change unless you pass
`--allow-destructive`, and refuses again if it cannot capture a snapshot first —
so there is always something to roll back to.

Snapshots use `pg_dump` against the direct connection string (not the pooler),
and are schema-only unless you set `<Postgres snapshot="full">`.

## Configuration

Connection settings live in [`.env.example`](./.env.example). `config.ts` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/supabase/.env` — gitignored, your local overrides.
2. `examples/supabase/.env.example` — committed demo defaults (local Supabase:
   `postgres:postgres@127.0.0.1:54322/postgres`).

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit — e.g. paste a hosted Supabase `DATABASE_URL`.
