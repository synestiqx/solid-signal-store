# AGENTS.md

Guidance for AI coding agents working in this repository. Human contributors should start
from `README.md`.

## What this package is

`@adsq/solid-signal-store` — a SolidJS reactive store built on a callable nested proxy.
Reading a path (`store.user.name()`) subscribes the caller to that exact path; assigning to
it (`store.user.name = 'Ada'`) wakes only that path's consumers.

**The full API reference for agents lives in [`SKILL.md`](./SKILL.md)** — read it before
writing code that uses the store. It is written in the [Agent Skills](https://agentskills.io)
format and covers the architecture rule, the JSX rules, batching, wake modes, and JSNQ.
Consumers of the published package can install it as a skill; see the README section
"Use With AI Coding Agents".

## Repository layout

- `src/core/` — store lifecycle, named registry, batching, wake modes.
- `src/proxy/` — the callable nested proxy and its reactivity bindings.
- `src/array/` — array method dispatch and mutation handling.
- `src/jsnq/solid-pipeline-bridge.ts` — the optional JSNQ integration. The engine itself
  is the separate `@adsq/jsnq` package; do not vendor or fork it here.
- `test/` — contract tests; `test/browser/` — Playwright specs.
- `examples/browser-demo/` — a real Vite + Solid app that the Playwright suite drives.

## Working rules

- **`dist/` is generated and git-ignored.** Never edit it and never commit it. `prepack`
  builds it for npm.
- **Do not reach into `@adsq/jsnq` internals.** Use its documented entries only.
- **Keep the demo in sync.** `examples/browser-demo` is not decoration — the browser tests
  assert against it, so an API change usually means updating it too.
- Match the surrounding code: no new dependencies, no framework fighting, no duplicated
  path logic (`src/utils/path-utils.ts` is the single source of truth for path parsing).

## Verify before proposing a change

```sh
bun run typecheck
bun run test          # 16 contract suites
bun run build
bun run test:browser  # Playwright against the real demo
```

All four must pass. `bun install` prints a `404 @adsq/jsnq` line for the unpublished peer
in some setups; that is expected and not a failure — check the exit status of the suites.
