/**
 * @jsxRuntime automatic
 * @jsxImportSource @db-x/runtime
 *
 * The `todos` schema for MongoDB — reusable component, split from the
 * connection entry (`dbx.tsx`).
 *
 * This is where the document-store model shows: there is no `<Table>` and no
 * `<Column>`. A collection has no declared shape, so what DB-X manages is the
 * collection, its indexes, and its JSON Schema validator — see
 * `@db-x/mongodb-library`. Documents that already exist keep whatever shape
 * they have; the validator only constrains writes.
 */

import { Collection, Index, Mongo, SeedData } from '@db-x/mongodb-library'

export interface TodosSchemaProps {
	/** Connection URI — supplied by the entry file from env. */
	url: string
	/** Database the schema lands in. */
	database: string
}

export function TodosSchema(props: TodosSchemaProps) {
	return (
		<Mongo
			name="todos-db"
			url={props.url}
			database={props.database}
			protect
			description="Schema owner: todos service on MongoDB. Collections, indexes and validators only — never the server."
		>
			<Collection
				name="todos"
				description="User-visible todo items"
				// Mongo's equivalent of NOT NULL / type constraints. `strict` (the
				// default) applies it to updates of existing documents too, so
				// tightening this is flagged destructive by the diff.
				validator={{
					$jsonSchema: {
						bsonType: 'object',
						required: ['title', 'done', 'priority', 'created_at'],
						properties: {
							title: { bsonType: 'string', description: 'must be a string and is required' },
							done: { bsonType: 'bool' },
							priority: { bsonType: 'int', minimum: 0 },
							created_at: { bsonType: 'date' },
						},
					},
				}}
				validationLevel="strict"
				validationAction="error"
			>
				<Index name="idx_todos_done" keys={{ done: 1 }} />
				<Index name="idx_todos_priority_done" keys={{ priority: 1, done: 1 }} />
			</Collection>

			<SeedData
				name="initial-todos"
				// The documents live in `todos`, so the seed is downstream of it. The
				// JS is opaque to the runtime — declaring the edge is what orders the
				// two AND re-runs this seed when the collection is rebuilt empty.
				dependsOn={['collection:todos']}
				description="Demo documents for first-run local installs"
				js={`
          for (const doc of [
            { title: 'try the db-x mongodb demo', done: true },
            { title: 'read the README', done: false },
            { title: 'point MONGODB_URL at Atlas', done: false },
          ]) {
            // Upsert on title — Mongo has no ON CONFLICT DO NOTHING, so
            // idempotency is the seed's own job.
            dbx.todos.updateOne(
              { title: doc.title },
              { $setOnInsert: { ...doc, priority: 0, created_at: new Date() } },
              { upsert: true },
            );
          }
        `}
			/>
		</Mongo>
	)
}
