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
				<Column name="priority" type="integer" notNull default="0" />
				<Column name="created_at" type="text" notNull default="(datetime('now'))" />
				<Index name="idx_todos_done" columns={['done']} />
			</Table>

			<SeedData
				name="initial-todos"
				description="Demo rows for first-run local installs"
				sql={`
          INSERT INTO todos (title, done, color, priority) VALUES
            ('try the db-x demo', 'yo', 'blue', 0),
            ('read the README', 'yes', 'green', 1),
            ('ship the sqlite-library MVP', 'no', 'red', 2)
        `}
			/>
		</>
	)
}
