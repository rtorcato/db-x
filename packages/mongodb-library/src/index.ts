// @db-x/mongodb-library — MongoDB schema components for DB-X.
//
// A document store has no DDL, so the `<Table>/<Column>` model of
// @db-x/postgres-library does not apply (#42). What is declarable — and what
// this library manages — is:
//   - the collection itself,
//   - its indexes (`createIndex` / `dropIndex`),
//   - its JSON Schema validator (`collMod`).
//
// Document shape is otherwise the application's business. Same
// `defineComponent` contract as the rest of DB-X; runtime is shared via
// @db-x/runtime. Shells out to the `mongosh` CLI on PATH.

export { Mongo } from './mongo.js'
export type { MongoProps } from './mongo.js'
export type { MongoParentOutputs } from './exec.js'

export {
	Collection,
	Index,
	buildCollMod,
	buildCreateCollection,
	buildCreateIndex,
	buildDropIndex,
	collectionOptions,
	diffCollection,
	isValidatorTightened,
} from './collection.js'
export type {
	CollectionDiff,
	CollectionPrior,
	CollectionProps,
	IndexKeyValue,
	IndexSpec,
	ValidationAction,
	ValidationLevel,
	Validator,
} from './collection.js'

export { SeedData } from './seed.js'
export type { SeedDataProps, SeedDataOutputs } from './seed.js'
