// Auto-snapshot helpers for `db-x apply` (#7).
//
// Before executing any destructive DDL, `apply` captures a snapshot so the
// change is recoverable. This module decides *whether* a snapshot is needed
// (does the plan contain destructive changes?) and *where to point it* (find a
// connection in state to dump).

import type { Plan, SnapshotRef, StateFile } from '@db-x/runtime'
import type { PgDumpConnection } from '@db-x/snapshot-pg-dump'

/** True if any planned action performs a destructive change (DROP, TYPE narrow, …). */
export function planHasDestructive(plan: Plan): boolean {
	return plan.actions.some((a) => {
		const act = a.action
		return 'destructive' in act && Array.isArray(act.destructive) && act.destructive.length > 0
	})
}

/**
 * Find a database connection in state to snapshot. Duck-types the outputs a
 * `<Postgres>` / `<DatabaseTarget>` resource publishes (`{user, password,
 * database, exec}`) rather than matching a library-specific `kind`, so the CLI
 * stays decoupled from postgres-library. Returns the first match, or null if
 * no snapshot-capable connection is present.
 */
export function resolveSnapshotConnection(state: StateFile): PgDumpConnection | null {
	for (const res of Object.values(state.resources)) {
		const o = res.outputs as Record<string, unknown> | undefined
		const exec = o?.exec as PgDumpConnection['exec'] | undefined
		if (
			o &&
			typeof o.user === 'string' &&
			typeof o.password === 'string' &&
			typeof o.database === 'string' &&
			exec &&
			typeof exec.command === 'string' &&
			Array.isArray(exec.args)
		) {
			return { exec, user: o.user, password: o.password, database: o.database }
		}
	}
	return null
}

/**
 * Pick which snapshot id `db-x restore` should roll back to:
 *   1. an explicit `--snapshot <id>`, else
 *   2. the snapshot pinned to the current state revision (`state.snapshot` —
 *      the pre-apply snapshot of the last destructive apply), else
 *   3. the newest snapshot in the store.
 * Returns null only when there's no explicit/pinned id and the store is empty.
 * A returned id is not guaranteed to exist in the store — the caller verifies
 * and reports if it was pruned.
 */
export function selectSnapshotId(
	explicit: string | undefined,
	pinned: string | undefined,
	available: SnapshotRef[]
): string | null {
	return explicit ?? pinned ?? available[0]?.id ?? null
}
