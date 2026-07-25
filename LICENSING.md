# Licensing

DB-X uses a **two-license split**. The engine (runtime + CLI) is
source-available under the **Business Source License 1.1** (BSL); the schema
component library is **MIT**. This page is the authoritative map of which
license applies to which package.

> **Plain-English summary**
>
> - You can **read, modify, self-host, and run DB-X in production for free** —
>   including inside your own company.
> - You **cannot** take the **core** (`@db-x/runtime`, `@db-x/cli`) and offer it
>   to third parties as a hosted / managed / "as-a-service" product. That right
>   is reserved by the Licensor.
> - The **component library is MIT** — use it however you like, including
>   commercially and as a service.
> - Each BSL version **auto-converts to Apache-2.0 four years after it ships**.
>
> This is not legal advice. The authoritative terms are in [`LICENSE`](./LICENSE)
> (BSL) and [`LICENSES/MIT.txt`](./LICENSES/MIT.txt) (MIT).

## License map

### BSL 1.1 — core

| Path | Package |
|---|---|
| `packages/runtime` | `@db-x/runtime` |
| `packages/cli` | `@db-x/cli` |

### MIT — component library

| Path | Package |
|---|---|
| `packages/postgres-library` | `@db-x/postgres-library` |

Examples under `examples/` and the docs site under `apps/docs` are unpublished
and MIT for reference use.

## Relationship to Infra-X

DB-X's runtime is a fork of the [Infra-X](https://infra-x.dev) runtime engine.
Both projects share the same BSL/MIT model. The dependency points one way and
DB-X vendors its own copy of the engine so it stands alone.
