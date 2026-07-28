// Auto-snapshot helpers for `db-x apply` (#7) and `db-x restore`.
//
// Before executing any destructive change, `apply` captures a snapshot so the
// change is recoverable. This module decides *whether* a snapshot is needed
// (does the plan contain destructive changes?), *what to point it at* (find a
// connection in state), and *which driver can capture it* (#78).

import path from 'node:path'
import { STATE_DIR } from '@db-x/runtime'
import type { Plan, SnapshotDriver, SnapshotRef, StateFile } from '@db-x/runtime'
import { createMongodumpDriver } from '@db-x/snapshot-mongodump'
import { createPgDumpDriver } from '@db-x/snapshot-pg-dump'
import { createSqliteDriver } from '@db-x/snapshot-sqlite'

/** True if any planned action performs a destructive change (DROP, TYPE narrow, …). */
export function planHasDestructive(plan: Plan): boolean {
	return plan.actions.some((a) => {
		const act = a.action
		return 'destructive' in act && Array.isArray(act.destructive) && act.destructive.length > 0
	})
}

/** Driver tags a component can publish. Statically mapped — see `createSnapshotDriver`. */
type SnapshotDriverTag = 'pg-dump' | 'mongodump' | 'sqlite-backup'

/**
 * A snapshot-capable connection found in state, tagged with the driver that
 * can capture it. The fields each driver needs stay on `outputs`.
 */
export interface SnapshotTarget {
	driver: SnapshotDriverTag
	/** The raw resource outputs the driver config is built from. */
	outputs: Record<string, unknown>
	/** Human-readable target, for the `restore` confirmation note. */
	label: string
}

/**
 * Find a database connection in state to snapshot.
 *
 * Primary path: a resource whose outputs carry a `snapshotDriver` tag. The CLI
 * stays decoupled from any library-specific `kind` — a component declares what
 * can capture it, and this maps the tag to a factory.
 *
 * Fallback: state written before the tag existed. A Postgres-shaped record
 * (`{user, password, database, exec}`) is assumed pg_dump-able, which is what
 * the CLI did unconditionally before #78; a `{file, exec}` record is SQLite.
 * Only consulted when no tagged resource exists anywhere in state, so a tagged
 * connection is never mistaken for one of these.
 *
 * This path matters more than "old state files" suggests: a resource that
 * plans as `no-op` is never re-applied, so its stored outputs keep whatever
 * shape the version that created them wrote. Adding the tag to a component
 * does not retroactively tag an already-applied database.
 */
export function resolveSnapshotTarget(state: StateFile): SnapshotTarget | null {
	for (const res of Object.values(state.resources)) {
		const o = res.outputs as Record<string, unknown> | undefined
		const tag = o?.snapshotDriver
		if (o && isDriverTag(tag) && hasExec(o)) {
			return { driver: tag, outputs: o, label: describe(tag, o) }
		}
	}

	for (const res of Object.values(state.resources)) {
		const o = res.outputs as Record<string, unknown> | undefined
		if (
			o &&
			typeof o.user === 'string' &&
			typeof o.password === 'string' &&
			typeof o.database === 'string' &&
			hasExec(o)
		) {
			return { driver: 'pg-dump', outputs: o, label: describe('pg-dump', o) }
		}
		if (o && typeof o.file === 'string' && hasExec(o)) {
			return { driver: 'sqlite-backup', outputs: o, label: describe('sqlite-backup', o) }
		}
	}
	return null
}

/** Build the driver for a resolved target. Throws if the outputs are unusable. */
export function createSnapshotDriver(target: SnapshotTarget, workDir: string): SnapshotDriver {
	const storeDir = path.join(workDir, STATE_DIR, 'snapshots')
	const o = target.outputs
	const exec = o.exec as { command: string; args: string[]; env?: Record<string, string> }

	if (target.driver === 'sqlite-backup') {
		requireStrings(o, ['file'], 'sqlite-backup')
		return createSqliteDriver({ connection: { exec, file: o.file as string }, storeDir })
	}

	if (target.driver === 'mongodump') {
		requireStrings(o, ['uri', 'database'], 'mongodump')
		return createMongodumpDriver({
			connection: { exec, uri: o.uri as string, database: o.database as string },
			storeDir,
		})
	}

	requireStrings(o, ['user', 'password', 'database'], 'pg-dump')
	// `<Postgres snapshot>` decides schema-vs-full; absent (or state written
	// before the prop existed) keeps the original schema-only behavior.
	const pgMode = o.snapshotMode === 'full' ? 'full' : 'schema'
	return createPgDumpDriver({
		connection: {
			exec,
			user: o.user as string,
			password: o.password as string,
			database: o.database as string,
		},
		storeDir,
		mode: pgMode,
	})
}

function isDriverTag(value: unknown): value is SnapshotDriverTag {
	return value === 'pg-dump' || value === 'mongodump' || value === 'sqlite-backup'
}

function hasExec(o: Record<string, unknown>): boolean {
	const exec = o.exec as { command?: unknown; args?: unknown } | undefined
	return typeof exec?.command === 'string' && Array.isArray(exec.args)
}

function describe(driver: SnapshotDriverTag, o: Record<string, unknown>): string {
	if (driver === 'sqlite-backup') return String(o.file)
	const db = typeof o.database === 'string' ? o.database : '(unknown)'
	return driver === 'mongodump' ? db : `${db} as ${String(o.user)}`
}

function requireStrings(o: Record<string, unknown>, keys: string[], driver: string): void {
	const missing = keys.filter((k) => typeof o[k] !== 'string')
	if (missing.length > 0) {
		throw new Error(
			`Snapshot driver "${driver}" needs ${missing.join(', ')} in the resource outputs, but state has no such value(s). The component publishing snapshotDriver="${driver}" must publish them too.`
		)
	}
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
