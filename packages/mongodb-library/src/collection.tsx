// @jsxRuntime automatic
// @jsxImportSource @db-x/runtime

// `<Collection>` (function) + `<Index>` marker + the underlying
// `CollectionResource` (defineComponent).
//
// This is where the document-store model departs from `<Table>/<Column>`:
// Mongo has no column list to diff. What *is* declarable — and what this
// library manages — is the collection itself, its indexes, and its JSON
// Schema validator. Documents keep whatever shape they have; the validator
// only constrains writes.
//
// The validator is a prop, not a `<Validator>` child element: a collection has
// exactly one, and a marker component for a single object buys nothing that
// `validator={{...}}` doesn't. Flip it to a child if it ever grows siblings.

import { type AnyElement, type Child, type PlanAction, defineComponent } from '@db-x/runtime'
import { findMongoParent, queryJson, requireMongoParent, runJs } from './exec.js'

// ─────────────────────────────────────────────────────────────────────────────
//  <Index> — marker absorbed by <Collection> at render time
// ─────────────────────────────────────────────────────────────────────────────

/** Mongo index key direction / type: `1`, `-1`, `'text'`, `'2dsphere'`, … */
export type IndexKeyValue = 1 | -1 | string

export interface IndexSpec {
	/** Index name. Stable identity for the diff — renaming drops and recreates. */
	name: string
	/** Key spec, e.g. `{ priority: 1, done: -1 }`. Order is significant to Mongo. */
	keys: Record<string, IndexKeyValue>
	unique?: boolean
	/** Partial-index filter, e.g. `{ done: false }`. */
	partialFilterExpression?: Record<string, unknown>
	/** TTL index: seconds after the indexed date field before a doc expires. */
	expireAfterSeconds?: number
	/** AI-readable purpose for this index. */
	description?: string
}

export function Index(_props: IndexSpec): never {
	throw new Error('<Index> must be a child of <Collection>.')
}

// ─────────────────────────────────────────────────────────────────────────────
//  <Collection> — function component that returns <CollectionResource>
// ─────────────────────────────────────────────────────────────────────────────

/** A `$jsonSchema` document validator. Shape is Mongo's, passed through as-is. */
export type Validator = Record<string, unknown>

export type ValidationLevel = 'off' | 'moderate' | 'strict'
export type ValidationAction = 'warn' | 'error'

export interface CollectionProps {
	name: string
	/** `$jsonSchema` (or any Mongo query-shaped) validator. */
	validator?: Validator
	/** How strictly the validator applies to updates. Mongo defaults to `strict`. */
	validationLevel?: ValidationLevel
	/** Reject (`error`, Mongo's default) or log (`warn`) invalid writes. */
	validationAction?: ValidationAction
	/** AI-readable purpose for this collection. */
	description?: string
	children?: Child | Child[]
}

export function Collection(props: CollectionProps) {
	const indexes: IndexSpec[] = []
	for (const child of asArray(props.children)) {
		if (!isElement(child)) continue
		if (child.type === Index) indexes.push(child.props as unknown as IndexSpec)
	}
	return (
		<CollectionResource
			name={props.name}
			validator={props.validator}
			validationLevel={props.validationLevel}
			validationAction={props.validationAction}
			description={props.description}
			indexes={indexes}
		/>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
//  CollectionResource — the diff'd, applied, destroyed resource
// ─────────────────────────────────────────────────────────────────────────────

interface CollectionResourceProps {
	name: string
	validator?: Validator
	validationLevel?: ValidationLevel
	validationAction?: ValidationAction
	description?: string
	indexes: IndexSpec[]
}

interface CollectionResourceOutputs {
	name: string
	validator?: Validator
	validationLevel?: ValidationLevel
	validationAction?: ValidationAction
	/** Index specs, so the next diff can detect changed and removed indexes. */
	indexes: IndexSpec[]
	/**
	 * Set by `refresh` when the collection isn't there any more. An empty index
	 * list can't say this on its own — declaring no indexes is legal — and the
	 * repair differs: a missing collection needs `createCollection` (which is
	 * what restores the validator), not a stack of `createIndex` calls.
	 */
	missing?: boolean
	[key: string]: unknown
}

function normalizePriorIndexes(raw: unknown): IndexSpec[] {
	return Array.isArray(raw) ? (raw as IndexSpec[]) : []
}

const CollectionResource = defineComponent<CollectionResourceProps, CollectionResourceOutputs>({
	kind: '@db-x/mongodb-library:collection',
	apply: async (props, ctx, prior) => {
		const parent = requireMongoParent(ctx, 'Collection')

		// The shape the database actually has once this apply is done. Only the
		// create and the diff below move it off the last-applied one.
		let applied = outputsOf(props)

		// `createCollection` is idempotent enough here (it throws only if the
		// collection exists, which `refresh` has just told us it doesn't), and it
		// is the only path that re-applies the validator.
		if (!prior || prior.outputs.missing) {
			ctx.log.info(`Creating collection ${props.name}`)
			await runJs(parent, buildCreateCollection(props), ctx)
		} else {
			const diff = diffCollection(props, {
				validator: prior.outputs.validator,
				validationLevel: prior.outputs.validationLevel,
				validationAction: prior.outputs.validationAction,
				indexes: normalizePriorIndexes(prior.outputs.indexes),
			})
			if (diff.js.length === 0) {
				ctx.log.info(`Collection ${props.name} unchanged`)
				// Nothing ran, so the live collection still matches what we last
				// applied. Recording the desired shape instead would claim a change
				// that never happened, and the next diff — which reads `outputs` —
				// would never plan the repair.
				applied = { ...prior.outputs }
			} else {
				ctx.log.info(
					`Collection ${props.name}: ${diff.addedIndexes.length} index add(s), ${diff.changedIndexes.length} index change(s), ${diff.droppedIndexes.length} index drop(s)${diff.validatorChanged ? ', validator updated' : ''}`
				)
				await runJs(parent, diff.js.join('\n'), ctx)
			}
		}

		// Always re-run the creates: `createIndex` is idempotent when the spec
		// matches, so this costs one round trip and self-heals an index dropped
		// behind our back. (Removed ones are dropped by the diff above.)
		if (props.indexes.length > 0) {
			await runJs(parent, props.indexes.map((i) => buildCreateIndex(props.name, i)).join('\n'), ctx)
		}
		return applied
	},
	destroy: async (state, ctx) => {
		const parent = findMongoParent(ctx)
		if (!parent) {
			ctx.log.warn(`Parent mongo missing; skipping drop of collection ${state.outputs.name}`)
			return
		}
		ctx.log.info(`Dropping collection ${state.outputs.name}`)
		try {
			await runJs(parent, `${coll(state.outputs.name)}.drop();`, ctx)
		} catch (err) {
			ctx.log.warn(`drop failed: ${(err as Error).message}`)
		}
	},
	/**
	 * Read-only drift check: does the live collection still carry the indexes we
	 * applied? Answers the question `db-x refresh` exists for — "someone dropped
	 * an index / dropped the collection behind my back".
	 *
	 * Returns the stored outputs unchanged when they match, so an in-sync
	 * database reports no drift rather than churning: Mongo echoes a validator
	 * back with its own key ordering and `$jsonSchema` spelling, which a
	 * round-trip comparison would read as a change on every refresh.
	 *
	 * ponytail: compares index NAMES, not keys or options, and doesn't read the
	 * validator back at all. That catches what actually happens — an index or a
	 * whole collection dropped out of band. A silently *redefined* index is
	 * already caught at diff time by `indexShape`, against what we last applied.
	 */
	refresh: async (state, ctx) => {
		const parent = findMongoParent(ctx)
		if (!parent) {
			ctx.log.warn(`Parent mongo missing; cannot refresh collection ${state.outputs.name}`)
			return state.outputs
		}
		const name = state.outputs.name
		// `missing` rather than an empty index list: a collection is allowed to
		// declare no indexes, so `[]` can't distinguish "gone" from "bare". The
		// flag is what routes apply back through `createCollection`, which is the
		// only path that restores the validator.
		const gone = { ...state.outputs, indexes: [], missing: true }

		let live: { exists: boolean; indexes: LiveIndex[] }
		try {
			live = await queryJson<{ exists: boolean; indexes: LiveIndex[] }>(
				parent,
				introspectExpression(name),
				ctx
			)
		} catch (err) {
			ctx.log.warn(`${name}: ${(err as Error).message}`)
			return gone
		}
		if (!live.exists) return gone

		// It's there, so clear any `missing` a previous refresh recorded —
		// otherwise the plan would keep insisting on a create.
		const present = { ...state.outputs }
		present.missing = undefined

		// `_id_` is Mongo's own, created with every collection and undroppable.
		const liveNames = live.indexes
			.map((i) => String(i.name))
			.filter((n) => n !== '_id_')
			.sort()
		const storedNames = state.outputs.indexes.map((i) => i.name).sort()
		if (JSON.stringify(liveNames) === JSON.stringify(storedNames)) return present

		// Keep the authored spec for every index that survived; describe only
		// genuinely-unknown ones. An index we never authored gets empty `keys`,
		// which `indexShape` reads as a shape we can't vouch for.
		const stored = new Map(state.outputs.indexes.map((i) => [i.name, i]))
		return {
			...present,
			indexes: liveNames.map((n) => stored.get(n) ?? { name: n, keys: {} }),
		}
	},
	// Pure diff at plan time so `preview` / `apply` can classify destructive
	// changes (index drops, validator tightening) before anything runs.
	plan: (props, prior): PlanAction => {
		if (!prior) return { type: 'create' }
		// refresh looked and found no collection. `collMod` would fail against
		// something that isn't there; it needs creating.
		if (prior.outputs.missing) return { type: 'create' }
		// Deliberately NOT short-circuiting on `props === prior.props`: refresh
		// writes observed reality into `outputs`, so identical props can still
		// need work (a column dropped out of band). Diffing against outputs is
		// what makes `refresh` -> `preview` -> `apply` reconcile drift at all.

		const diff = diffCollection(props, {
			validator: prior.outputs.validator,
			validationLevel: prior.outputs.validationLevel,
			validationAction: prior.outputs.validationAction,
			indexes: normalizePriorIndexes(prior.outputs.indexes),
		})
		if (diff.js.length === 0) {
			// Nothing to run against the database; only persist if props moved
			// (a changed `description`, say).
			return JSON.stringify(props) === JSON.stringify(prior.props)
				? { type: 'no-op' }
				: { type: 'update', reason: 'props changed' }
		}
		const reason =
			diff.js.length > 0
				? `${diff.addedIndexes.length} index add(s), ${diff.changedIndexes.length} index change(s), ${diff.droppedIndexes.length} index drop(s)${diff.validatorChanged ? ', validator updated' : ''}`
				: 'props changed'
		return diff.destructive.length > 0
			? { type: 'update', reason, destructive: diff.destructive, details: diff.js }
			: { type: 'update', reason, details: diff.js }
	},
})

function outputsOf(props: CollectionResourceProps): CollectionResourceOutputs {
	return {
		name: props.name,
		validator: props.validator,
		validationLevel: props.validationLevel,
		validationAction: props.validationAction,
		indexes: props.indexes,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
//  Script builders — exported for tests + the future `db-x preview` surface
// ─────────────────────────────────────────────────────────────────────────────

/** `dbx` is bound to the target database by `wrapScript` in exec.ts. */
function coll(name: string): string {
	return `dbx.getCollection(${JSON.stringify(name)})`
}

/** What `getIndexes()` gives back — only the name is load-bearing here. */
interface LiveIndex {
	name: string
	[key: string]: unknown
}

/**
 * Existence + live indexes in one round trip. Guarded by `getCollectionNames()`
 * because `getIndexes()` on a missing collection throws, and a drift check must
 * report absence rather than fail.
 */
export function introspectExpression(collection: string): string {
	const name = JSON.stringify(collection)
	return (
		`(dbx.getCollectionNames().includes(${name}) ` +
		`? { exists: true, indexes: ${coll(collection)}.getIndexes() } ` +
		': { exists: false, indexes: [] })'
	)
}

/** The `createCollection` / `collMod` options block, omitted when empty. */
export function collectionOptions(props: {
	validator?: Validator
	validationLevel?: ValidationLevel
	validationAction?: ValidationAction
}): Record<string, unknown> {
	const opts: Record<string, unknown> = {}
	if (props.validator !== undefined) opts.validator = props.validator
	if (props.validationLevel !== undefined) opts.validationLevel = props.validationLevel
	if (props.validationAction !== undefined) opts.validationAction = props.validationAction
	return opts
}

/**
 * Create the collection if absent, otherwise bring its validator in line.
 * `createCollection` throws `NamespaceExists` rather than being idempotent, so
 * the existence check is part of the script, not a separate round trip.
 */
export function buildCreateCollection(props: {
	name: string
	validator?: Validator
	validationLevel?: ValidationLevel
	validationAction?: ValidationAction
}): string {
	const name = JSON.stringify(props.name)
	const opts = collectionOptions(props)
	const hasOpts = Object.keys(opts).length > 0
	const create = hasOpts
		? `dbx.createCollection(${name}, ${JSON.stringify(opts)});`
		: `dbx.createCollection(${name});`
	const update = hasOpts
		? `dbx.runCommand(${JSON.stringify({ collMod: props.name, ...opts })});`
		: null
	return [
		`if (!dbx.getCollectionNames().includes(${name})) {`,
		`  ${create}`,
		...(update ? ['} else {', `  ${update}`] : []),
		'}',
	].join('\n')
}

export function buildCreateIndex(collection: string, idx: IndexSpec): string {
	const options: Record<string, unknown> = { name: idx.name }
	if (idx.unique) options.unique = true
	if (idx.partialFilterExpression) options.partialFilterExpression = idx.partialFilterExpression
	if (idx.expireAfterSeconds !== undefined) options.expireAfterSeconds = idx.expireAfterSeconds
	return `${coll(collection)}.createIndex(${JSON.stringify(idx.keys)}, ${JSON.stringify(options)});`
}

/**
 * Dropping an index that may not exist — `dropIndex` throws `IndexNotFound`,
 * which would abort the rest of the script for no reason.
 */
export function buildDropIndex(collection: string, name: string): string {
	return `if (${coll(collection)}.getIndexes().some((i) => i.name === ${JSON.stringify(name)})) ${coll(collection)}.dropIndex(${JSON.stringify(name)});`
}

export function buildCollMod(props: {
	name: string
	validator?: Validator
	validationLevel?: ValidationLevel
	validationAction?: ValidationAction
}): string {
	const opts = collectionOptions(props)
	// An empty `validator` clears a previously-set one — collMod needs the key
	// present to unset it, so absent-in-JSX means `{}`, not "leave alone".
	const body = { collMod: props.name, validator: {}, ...opts }
	return `dbx.runCommand(${JSON.stringify(body)});`
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pure diff
// ─────────────────────────────────────────────────────────────────────────────

export interface CollectionPrior {
	validator?: Validator
	validationLevel?: ValidationLevel
	validationAction?: ValidationAction
	indexes: IndexSpec[]
}

export interface CollectionDiff {
	/** Indexes declared for the first time. */
	addedIndexes: IndexSpec[]
	/** Same name, different keys/options — dropped and recreated. */
	changedIndexes: IndexSpec[]
	/** Names present in prior state but no longer declared. */
	droppedIndexes: string[]
	validatorChanged: boolean
	/** Statements in apply order. */
	js: string[]
	/**
	 * The subset of `js` that is destructive: dropping an index (a rebuild can
	 * take hours on a large collection) or tightening a validator (existing
	 * documents can stop being updatable).
	 */
	destructive: string[]
}

/** Index identity for change detection: keys + every option that alters it. */
function indexShape(i: IndexSpec): string {
	return JSON.stringify([i.keys, !!i.unique, i.partialFilterExpression, i.expireAfterSeconds])
}

/**
 * True when the new validator can reject documents the old one accepted.
 *
 * ponytail: heuristic — adding a validator where there was none, raising the
 * enforcement level, or requiring more fields. It does not compare property
 * subschemas (a widened `minLength`, a narrowed `enum`), so a tightening
 * buried inside `properties` reads as non-destructive. Upgrade path is a real
 * JSON Schema subset check; until then `protect` is the backstop.
 */
export function isValidatorTightened(prior: CollectionPrior, next: CollectionProps): boolean {
	const hadValidator = prior.validator !== undefined && Object.keys(prior.validator).length > 0
	const hasValidator = next.validator !== undefined && Object.keys(next.validator).length > 0
	if (!hasValidator) return false
	if (!hadValidator) return true

	// `off` → `moderate` / `strict`, or `moderate` → `strict`.
	const rank: Record<string, number> = { off: 0, moderate: 1, strict: 2 }
	const priorLevel = rank[prior.validationLevel ?? 'strict'] ?? 2
	const nextLevel = rank[next.validationLevel ?? 'strict'] ?? 2
	if (nextLevel > priorLevel) return true

	// `warn` → `error`.
	if (
		(prior.validationAction ?? 'error') === 'warn' &&
		(next.validationAction ?? 'error') === 'error'
	) {
		return true
	}

	const required = (v: Validator | undefined): string[] => {
		const schema = v?.$jsonSchema as { required?: unknown } | undefined
		return Array.isArray(schema?.required) ? (schema.required as string[]) : []
	}
	const priorRequired = new Set(required(prior.validator))
	return required(next.validator).some((f) => !priorRequired.has(f))
}

export function diffCollection(next: CollectionProps, prior: CollectionPrior): CollectionDiff {
	const nextIndexes = collectIndexes(next)
	const priorByName = new Map(prior.indexes.map((i) => [i.name, i]))
	const nextNames = new Set(nextIndexes.map((i) => i.name))

	const addedIndexes = nextIndexes.filter((i) => !priorByName.has(i.name))
	const changedIndexes = nextIndexes.filter((i) => {
		const p = priorByName.get(i.name)
		return p !== undefined && indexShape(p) !== indexShape(i)
	})
	const droppedIndexes = prior.indexes.filter((i) => !nextNames.has(i.name)).map((i) => i.name)

	const validatorChanged =
		JSON.stringify(collectionOptions(prior)) !== JSON.stringify(collectionOptions(next))

	// Order matters: drops first (frees the name), then creates.
	const dropJs = [
		...droppedIndexes.map((n) => buildDropIndex(next.name, n)),
		...changedIndexes.map((i) => buildDropIndex(next.name, i.name)),
	]
	const js = [
		...(validatorChanged ? [buildCollMod(next)] : []),
		...dropJs,
		...changedIndexes.map((i) => buildCreateIndex(next.name, i)),
		...addedIndexes.map((i) => buildCreateIndex(next.name, i)),
	]

	const destructive = [
		...dropJs,
		...(validatorChanged && isValidatorTightened(prior, next) ? [buildCollMod(next)] : []),
	]

	return { addedIndexes, changedIndexes, droppedIndexes, validatorChanged, js, destructive }
}

/** `<Collection>` passes indexes as a prop; the diff accepts either shape. */
function collectIndexes(props: CollectionProps & { indexes?: IndexSpec[] }): IndexSpec[] {
	if (Array.isArray(props.indexes)) return props.indexes
	const found: IndexSpec[] = []
	for (const child of asArray(props.children)) {
		if (isElement(child) && child.type === Index) found.push(child.props as unknown as IndexSpec)
	}
	return found
}

// ─────────────────────────────────────────────────────────────────────────────
//  JSX child utilities
// ─────────────────────────────────────────────────────────────────────────────

function asArray(value: Child | Child[] | undefined): Child[] {
	if (value === undefined || value === null) return []
	return Array.isArray(value) ? value : [value]
}

function isElement(value: Child): value is AnyElement {
	return (
		value !== null &&
		typeof value === 'object' &&
		'$$typeof' in value &&
		'type' in value &&
		'props' in value
	)
}
