/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * The todos schema, as a reusable component — no connection/env here. Drop
 * it inside any `<Sqlite file=...>` parent (see `dbx.tsx`).
 */

import { Column, Index, SeedData, Table } from '@db-x/sqlite-library'

export function TodosSchema() {
	return (
		<>
			<Table name="todos" description="User-visible todo items">
				<Column name="id" type="integer" primaryKey />
				<Column name="title" type="text" notNull />
				<Column name="done" type="integer" notNull default="0" />
				<Column name="color" type="text" default="'blue'" />
				<Column name="dueDate" type="text" default="''" />
				<Column name="priority" type="integer" notNull default="0" />
				<Column name="created_at" type="text" notNull default="(datetime('now'))" />
				<Index name="idx_todos_done" columns={['done']} />
			</Table>

			{/*
			 * Seeds re-run whenever this SQL changes, so they have to be
			 * idempotent — and idempotency needs a conflict *target*. A bare
			 * INSERT with an autoincrement id has none, so every edit appended a
			 * fresh copy of every row. Pinning the ids makes the primary key the
			 * target; DO UPDATE then makes the seed declarative, so editing a
			 * value here changes the existing row instead of adding a new one.
			 * The autoincrement continues past the pinned ids, so hand-added
			 * rows are unaffected.
			 */}
			<SeedData
				name="initial-todos"
				// The rows live in `todos`, so the seed is downstream of it. Raw SQL
				// is opaque to the runtime — declaring the edge is what orders the
				// two AND re-runs this seed when the table is rebuilt empty.
				dependsOn={['table:todos']}
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (id, title, done, color, dueDate, priority) VALUES
            (1, 'try the db-x demo', 1, 'blue', '', 0),
            (2, 'read the README', 0, 'green', '', 1),
            (3, 'ship the sqlite-library MVP', 0, 'red', '', 2)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            done = excluded.done,
            color = excluded.color,
            dueDate = excluded.dueDate,
            priority = excluded.priority
        `}
			/>
		</>
	)
}
