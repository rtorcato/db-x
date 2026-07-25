# `@db-x/cli`

> 🚧 **Early alpha — not production ready.** Incompletely tested, APIs change
> without notice. Don't use it to manage production infrastructure. Provided
> "AS IS", no warranty.
>
> **License:** Business Source License 1.1 (converts to Apache-2.0 four years
> after each release). See [`LICENSING.md`](../../LICENSING.md).

The `db-x` binary.

```
db-x                   # interactive menu
db-x preview <file>    # render → diff vs state → print plan
db-x apply <file>      # render → diff → confirm → execute
db-x destroy <file>    # confirm → tear down all resources
db-x state             # show current state
db-x help              # colored usage
```

Flags:
- `--yes`, `-y` — skip confirmation prompts (for CI)

Interactive: when run without args (or without a `<file>` for a command that
needs one), prompts via [`@clack/prompts`](https://github.com/natemoo-re/clack).
Spinners run during `apply`/`destroy`; per-resource success/error messages
print above the spinner.

Color: via [`picocolors`](https://github.com/alexeyraspopov/picocolors). Auto-
disables on non-TTY stdout or when `NO_COLOR` is set.

Loads `.tsx`/`.jsx` files via the `tsx` ESM loader. No separate build step.
