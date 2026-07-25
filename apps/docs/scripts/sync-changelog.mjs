// Sync the DB-X changelog into the docs site.
//
// DB-X releases ship through the workspace packages `@db-x/runtime` and
// `@db-x/postgres-library`; each carries its own CHANGELOG.md as it matures.
// For now this script writes a placeholder pointing back at the upstream
// CHANGELOG.md until the first DB-X release lands.
//
// The output file (docs/changelog.md) is gitignored — it is regenerated on
// every docs build (wired as the prebuild script).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const repoRoot = resolve(appRoot, "../..");
const target = resolve(appRoot, "docs/changelog.md");

const frontmatter = `---
title: Changelog
description: Release notes for DB-X.
---

`;

// Source: prefer the dedicated DB-X package changelogs when they exist;
// otherwise fall back to a single placeholder section.
const sources = [
	resolve(repoRoot, "packages/db-x-runtime/CHANGELOG.md"),
	resolve(repoRoot, "packages/db-x-postgres-library/CHANGELOG.md"),
].filter(existsSync);

let body;
if (sources.length === 0) {
	body =
		"# Changelog\n\n" +
		"DB-X has not cut its first release yet. Track progress in the " +
		"[Phase 5 tracker](https://github.com/rtorcato/infra-x/issues/24) " +
		"and [GOALS.md](https://github.com/rtorcato/infra-x/blob/main/docs/dbx/GOALS.md).\n";
} else {
	body = sources
		.map((path) => {
			const pkg = path.includes("postgres-library")
				? "@db-x/postgres-library"
				: "@db-x/runtime";
			return `## ${pkg}\n\n${readFileSync(path, "utf8")}`;
		})
		.join("\n\n");
}

writeFileSync(target, frontmatter + body);
console.log(`sync-changelog: wrote ${target}`);
