// Sync the DB-X changelog into the docs site.
//
// The repo keeps one CHANGELOG.md at the root (versions are per-repo; each
// package tracks its own version in package.json). Per-package changelogs may
// arrive as the packages mature — when they do, they win over the root file.
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

// Source: prefer per-package changelogs once they exist; otherwise use the
// root CHANGELOG.md, which is where every change is recorded today.
const packageSources = [
	resolve(repoRoot, "packages/runtime/CHANGELOG.md"),
	resolve(repoRoot, "packages/postgres-library/CHANGELOG.md"),
].filter(existsSync);

const rootChangelog = resolve(repoRoot, "CHANGELOG.md");

let body;
if (packageSources.length > 0) {
	body = packageSources
		.map((path) => {
			const pkg = path.includes("postgres-library")
				? "@db-x/postgres-library"
				: "@db-x/runtime";
			return `## ${pkg}\n\n${readFileSync(path, "utf8")}`;
		})
		.join("\n\n");
} else if (existsSync(rootChangelog)) {
	body = readFileSync(rootChangelog, "utf8");
} else {
	body =
		"# Changelog\n\n" +
		"DB-X has not cut its first release yet. Track progress in the " +
		"[milestones](https://github.com/rtorcato/db-x/milestones) and " +
		"[GOALS.md](https://github.com/rtorcato/db-x/blob/main/docs/GOALS.md).\n";
}

writeFileSync(target, frontmatter + body);
console.log(`sync-changelog: wrote ${target}`);
