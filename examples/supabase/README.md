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
supabase start                  # local Supabase stack (Supabase CLI + Docker)
pnpm preview                    # render JSX, diff against state, print the plan
pnpm apply                      # execute the DDL, persist state to .dbx/
pnpm destroy                    # tear it down in reverse order
supabase stop                   # stop the local stack
```

`preview` renders and diffs offline — it does **not** connect to a database.
`apply` shells out to `psql`, so it needs a reachable Postgres and `psql` on
PATH. `supabase start` provides a local stack with `auth.users` already
provisioned; or point `DATABASE_URL` at a hosted project's **direct connection**
string (Project Settings → Database).

The demo seeds no rows: `todos.user_id` is NOT NULL and references `auth.users`,
so a row needs a real user. After `apply`, create one and insert:

```sql
-- against the same DB (e.g. `supabase db` or psql)
select id from auth.users limit 1;  -- grab a real user id
insert into todos (user_id, title) values ('<that-id>', 'try the db-x supabase demo');
```

## Configuration

Connection settings live in [`.env.example`](./.env.example). `dbx.tsx` has **no
hardcoded credentials** — it reads everything from env vars, loaded from:

1. `examples/supabase/.env` — gitignored, your local overrides.
2. `examples/supabase/.env.example` — committed demo defaults (local Supabase:
   `postgres:postgres@127.0.0.1:54322/postgres`).

`.env` overrides `.env.example` when present. To customize, `cp .env.example .env`
and edit — e.g. paste a hosted Supabase `DATABASE_URL`.
