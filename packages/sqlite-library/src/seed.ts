// `<SeedData>` — inline SQL run once at apply time. Re-runs only when
// the SQL prop changes (the diff sees `~ update`), so the SQL must be
// idempotent — a re-run appends a second copy of every row otherwise.
//
// `ON CONFLICT` alone is not enough: it needs a conflict *target* that can
// actually fire. Against a generated primary key (`serial`, `gen_random_uuid()`)
// every run mints a fresh key, so nothing ever conflicts and the clause is
// decoration. Pin the keys in the seed and conflict on them:
//
//   INSERT INTO t (id, title) VALUES (1, 'first')
//   ON CONFLICT(id) DO UPDATE SET title = excluded.title
//
// Must be a child of `<Sqlite>`.
//
// Name the tables a seed fills in `dependsOn` — the SQL is opaque to the
// runtime, so that list is the only way it knows what this seed is downstream
// of. It buys correct ordering *and* a re-run when one of those tables is
// recreated (a rebuilt table comes back empty; the seed's own state can't tell):
//
//   <SeedData name="initial-todos" dependsOn={['table:todos']} sql={...} />

import { defineComponent } from '@db-x/runtime'
import { requireSqliteParent, runSql } from './exec.js'

export interface SeedDataProps {
	name: string
	/** Inline SQL. Must be idempotent — see the note above on conflict targets. */
	sql: string
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export interface SeedDataOutputs {
	name: string
	ranAt: string
	[key: string]: unknown
}

export const SeedData = defineComponent<SeedDataProps, SeedDataOutputs>({
	kind: '@db-x/sqlite-library:seed',
	// A seed's rows live in its table, not in its own outputs, so a table that
	// gets recreated comes back empty while this resource's state still says it
	// ran. Re-run whenever a declared dependency is rebuilt. This only reaches
	// the tables named in `dependsOn` — a seed is raw SQL, so the runtime can't
	// infer which tables it writes to; see the note above.
	reapplyOnDependencyRecreate: true,
	apply: async (props, ctx) => {
		const parent = requireSqliteParent(ctx, 'SeedData')
		ctx.log.info(`Seeding ${props.name}`)
		await runSql(parent, props.sql, ctx)
		return { name: props.name, ranAt: new Date().toISOString() }
	},
	destroy: async (state, ctx) => {
		// No-op by design. Seed data lives with its table; dropping the
		// table takes the rows with it. Re-applying with new SQL is the way
		// to evolve.
		ctx.log.info(`SeedData ${state.outputs.name}: no-op destroy`)
	},
})
