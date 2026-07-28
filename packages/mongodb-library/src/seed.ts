// `<SeedData>` — inline mongosh JS run at apply time. Re-runs only when the
// `js` prop changes (the diff sees `~ update`). For idempotent writes, use
// `updateOne(..., { upsert: true })` or a unique index — Mongo has no
// `ON CONFLICT DO NOTHING`.
//
// Must be a child of `<Mongo>`. The target database is bound to `dbx` for you.

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
