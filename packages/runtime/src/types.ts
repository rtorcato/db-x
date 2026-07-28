// Public type definitions shared across the DB-X runtime.

export type PhaseType = 'setup' | 'monitoring' | 'backup' | 'teardown'

/** A single resource node in the desired-state graph produced from JSX. */
export interface Resource {
	/** Stable resource id. Derived from `props.id`, `props.name`, or path. */
	id: string
	/** Namespaced component kind, e.g. `@vercel/db-x:project`. */
	kind: string
	/** Resolved props at render time. */
	props: Record<string, unknown>
	/** Resource ids this resource depends on (explicit + parent-implied). */
	dependsOn: string[]
	/** Parent resource id, set for JSX children. */
	parent?: string
	/** Phase membership, propagated from the enclosing `<Phase>` element. */
	phase?: PhaseType
}

/** Desired-state graph: the unit of diff. */
export interface Graph {
	resources: Record<string, Resource>
	outputs: Record<string, unknown>
}

/** Persisted state of a single resource after a successful `apply`. */
export interface ResourceState<TProps = object, TOutputs = object> {
	id: string
	kind: string
	props: TProps
	outputs: TOutputs
	dependsOn: string[]
	/** Parent resource id, set for JSX children. Persisted so destroy() can resolve parent context. */
	parent?: string
	phase?: PhaseType
	/** ISO 8601 timestamp of the last successful apply. */
	lastApplied: string
}

/** Metadata about the resource currently being applied, exposed via `ctx.resource`. */
export interface ResourceMeta {
	id: string
	kind: string
	parent?: string
	phase?: PhaseType
	dependsOn: string[]
}

/** Logger handed to component lifecycle hooks via `ctx.log`. */
export interface CtxLogger {
	info: (msg: string, data?: unknown) => void
	warn: (msg: string, data?: unknown) => void
	error: (msg: string, data?: unknown) => void
	debug: (msg: string, data?: unknown) => void
}

/** Context passed to every `apply` / `destroy` / `refresh` invocation. */
export interface Ctx {
	/** Typed view over `process.env`. v0.1 reads env vars only. */
	secrets: Readonly<Record<string, string | undefined>>
	/** Metadata about this resource. */
	resource: ResourceMeta
	/** Scoped logger; output appears under the resource id in CLI output. */
	log: CtxLogger
	/** Outputs from resources this one depends on, keyed by resource id. */
	deps: Readonly<Record<string, object>>
	/** Absolute path to the `.dbx/` directory. Use for scratch files. */
	workDir: string
	/** Honor this signal in long-running operations so Ctrl-C works cleanly. */
	signal: AbortSignal
	/** True during `preview` — perform reads only, no mutations. */
	dryRun: boolean
}

/**
 * Spawn template a runtime publishes so child components can run commands
 * inside whatever context the runtime represents — a docker container, a
 * remote host over SSH, a local subprocess, etc. The runtime is opaque to
 * the consumer; it just prepends `command + args` and inherits `env`/`cwd`.
 *
 * Example (docker `<Service>` from @db-x/docker-library):
 *
 *   {
 *     command: 'docker',
 *     args:    ['compose', '-p', 'my-stack', 'exec', '-T', 'db'],
 *     env:     { DOCKER_HOST: 'ssh://user@host' },  // forwarded from <Host>
 *   }
 *
 * A child library (e.g. @db-x/postgres-library) appends its own command:
 *
 *   spawn(exec.command, [...exec.args, 'psql', '-U', 'foo', '-c', sql], { env, cwd })
 */
export interface RuntimeExec {
	command: string
	args: string[]
	env?: Record<string, string | undefined>
	cwd?: string
}

/**
 * The action the diff engine plans to take for a single resource.
 *
 * `destructive`, when present and non-empty, lists the human-readable
 * destructive changes this action entails (e.g. `DROP INDEX "idx_old"`,
 * `ALTER COLUMN "amount" TYPE ...`). The CLI marks these in `preview` and
 * refuses to `apply` them without `--allow-destructive` — or unconditionally
 * when the resource is under a `protect`-ed ancestor.
 *
 * `details` is the exact statements the apply will run, in order. A component
 * that already computes them at plan time should pass them through: `reason`
 * is a summary ("1 addition(s)"), and a summary is not enough to review a
 * migration. Entries that also appear in `destructive` are flagged as such.
 */
export type PlanAction =
	| { type: 'create' }
	| { type: 'update'; reason: string; destructive?: string[]; details?: string[] }
	| { type: 'replace'; reason: string; destructive?: string[]; details?: string[] }
	| { type: 'destroy'; reason: string; destructive?: string[]; details?: string[] }
	| { type: 'no-op' }

/** Minimal validator interface. Compatible with zod, valibot, custom validators. */
export interface Schema<T> {
	parse: (input: unknown) => T
}

/** The full specification a third-party component author passes to `defineComponent`. */
export interface ComponentSpec<TProps extends object, TOutputs extends object> {
	/** Globally unique kind, conventionally `<package-name>:<resource-name>`. */
	kind: string
	/** Optional runtime validation of `props` before `apply`. */
	schema?: Schema<TProps>
	/** Create or update the resource. Receives `prior` for UPDATE actions. */
	apply: (
		props: TProps,
		ctx: Ctx,
		prior: ResourceState<TProps, TOutputs> | null
	) => Promise<TOutputs>
	/** Tear down the resource. Must tolerate 404 / already-gone. */
	destroy: (state: ResourceState<TProps, TOutputs>, ctx: Ctx) => Promise<void>
	/** Optional drift check — pure read, must not mutate. */
	refresh?: (state: ResourceState<TProps, TOutputs>, ctx: Ctx) => Promise<TOutputs>
	/** Optional custom diff. Default is shallow JSON equality on props. */
	plan?: (props: TProps, state: ResourceState<TProps, TOutputs> | null) => PlanAction
	/** Optional defaults merged into props before validation. */
	defaults?: Partial<TProps>
}
