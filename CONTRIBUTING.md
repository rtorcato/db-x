# Contributing

## Working on this repo

Branch per issue, PR, merge when CI is green.

| | |
|---|---|
| **Branch name** | `<type>/<issue-N>-<short-name>` — e.g. `feat/12-shadow-db-preview`, `fix/13-column-rename` |
| **Types** | `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test` |
| **PR title** | Conventional Commit format (`feat(cli): add refresh command`) — becomes the squash commit subject on `main` |
| **Merge** | Squash only — `main` stays linear, one commit per change |
| **Branch lifecycle** | Auto-deleted on merge |

```bash
git fetch origin main
git switch -c feat/12-shadow-db-preview origin/main

git commit -m "feat(cli): add shadow-db preview"

git push -u origin feat/12-shadow-db-preview
gh pr create --fill

# db-x is a private repo without branch protection, so auto-merge is
# disabled (it would merge on request with nothing gating it). Wait for
# CI to go green, then merge manually:
gh pr merge --squash --delete-branch

git switch main && git pull --ff-only
```

If the repo later goes public (or the account gets GitHub Pro/Team), enable
branch protection on `main` with required status checks, turn
`allow_auto_merge` back on, and switch the last step to
`gh pr merge --auto --squash --delete-branch`.

## Development

```bash
pnpm install
pnpm build       # tsc -b — build all packages
pnpm test:run    # run all package tests
pnpm check       # biome lint + format check
```
