// SnapshotDriver — the contract a schema Time Machine backend implements.
//
// A driver captures the database schema (and optionally data) at a point in
// time, pins the resulting artifact to the state revision it was taken from,
// and can restore or prune those artifacts later. @db-x/snapshot-pg-dump is
// the reference implementation (pg_dump); S3-backed and other drivers slot in
// behind the same interface later.

/** What a driver captures. `schema` is the default; `full` includes row data. */
export type SnapshotMode = 'schema' | 'full'

/** A pointer to one captured snapshot. Persisted in the driver's store index. */
export interface SnapshotRef {
	/** Opaque, driver-assigned id. Unique within a store. */
	id: string
	/**
	 * The state revision this snapshot was taken from — the `lastApplied`
	 * timestamp of `.dbx/state.json` at capture time. Links a snapshot back
	 * to the exact applied state it restores to.
	 */
	stateRev: string
	/** ISO 8601 capture time. */
	createdAt: string
	/** Driver that produced it, e.g. `pg-dump`. */
	driver: string
	mode: SnapshotMode
}

/** Retention policy for `prune`. v0.1: keep the N most recent. */
export interface PrunePolicy {
	/** Keep this many most-recent snapshots; older ones are removed. */
	keepLast: number
}

/**
 * Capture / restore / list / prune point-in-time database snapshots.
 * Implementations decide where artifacts live and how they are produced.
 */
export interface SnapshotDriver {
	/** Capture the current database, pinning the artifact to `stateRev`. */
	create(stateRev: string): Promise<SnapshotRef>
	/** Restore the database to the snapshot `ref` points at. */
	restore(ref: SnapshotRef): Promise<void>
	/** All snapshots in the store, newest first. */
	list(): Promise<SnapshotRef[]>
	/** Remove snapshots the policy excludes. Returns the refs that were pruned. */
	prune(policy: PrunePolicy): Promise<SnapshotRef[]>
}
