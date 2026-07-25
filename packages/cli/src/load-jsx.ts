// Dynamic loader for user `.tsx` / `.jsx` files.
//
// Uses `tsx`'s ESM API to transpile TypeScript + JSX on the fly so users do
// not need a separate build step. The user file's JSX is compiled against
// `@db-x/runtime` (via a `/** @jsxImportSource @db-x/runtime */`
// pragma at the top of the file).

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Child } from '@db-x/runtime'
import { tsImport } from 'tsx/esm/api'

export type LoadedJsx = Child | Child[]

export async function loadJsxFile(filePath: string): Promise<LoadedJsx> {
	const absolute = path.resolve(filePath)
	const url = pathToFileURL(absolute).href

	let mod: Record<string, unknown>
	try {
		mod = (await tsImport(url, import.meta.url)) as Record<string, unknown>
	} catch (err) {
		throw new Error(`Failed to load ${filePath}: ${(err as Error).message}`)
	}

	const def = mod.default
	if (def == null) {
		throw new Error(
			`${filePath} has no default export. Export your JSX tree as the default export.`
		)
	}
	return def as LoadedJsx
}
