// `<SeedData>` — inline mongosh JS run at apply time. Re-runs only when the
// `js` prop changes (the diff sees `~ update`). For idempotent writes, use
// `updateOne(..., { upsert: true })` or a unique index — Mongo has no
// `ON CONFLICT DO NOTHING`.
//
// Must be a child of `<Mongo>`. The target database is bound to `dbx` for you.
//
// Name the collections a seed fills in `dependsOn` — the JS is opaque to the
// runtime, so that list is the only way it knows what this seed is downstream
// of. It buys correct ordering *and* a re-run when one of those collections is
// recreated (a rebuilt collection comes back empty; the seed's own state can't
// tell):
//
//   <SeedData name="initial-todos" dependsOn={['collection:todos']} js={...} />

import { defineComponent } from '@db-x/runtime'
import { requireMongoParent, runJs } from './exec.js'

export interface SeedDataProps {
	name: string
	/** mongosh JS. `dbx` is the target database, e.g. `dbx.todos.insertOne(…)`. */
	js: string
	/** AI-readable purpose. Surfaced by `db-x describe` / MCP. */
	description?: string
}

export interface SeedDataOutputs {
	name: string
	ranAt: string
	[key: string]: unknown
}

export const SeedData = defineComponent<SeedDataProps, SeedDataOutputs>({
	kind: '@db-x/mongodb-library:seed',
	// A seed's documents live in its collection, not in its own outputs, so a
	// collection that gets recreated comes back empty while this resource's
	// state still says it ran. Re-run whenever a declared dependency is rebuilt.
	// This only reaches the collections named in `dependsOn` — a seed is opaque
	// JS, so the runtime can't infer what it writes to; see the note above.
	reapplyOnDependencyRecreate: true,
	apply: async (props, ctx) => {
		const parent = requireMongoParent(ctx, 'SeedData')
		ctx.log.info(`Seeding ${props.name}`)
		await runJs(parent, props.js, ctx)
		return { name: props.name, ranAt: new Date().toISOString() }
	},
	destroy: async (state, ctx) => {
		// No-op by design. Seed documents live with their collection; dropping
		// the collection takes them with it. Re-applying with new JS is the way
		// to evolve.
		ctx.log.info(`SeedData ${state.outputs.name}: no-op destroy`)
	},
})
