# Dispatch Maximization Iteration — 2026-05-31

User request (in Polish, decoded): "po prostu maksymalnie dispatch'owo bez ifów, ale tak żeby asynchroniczność nic nie popsuła, nie na siłę."

## What was done

Replaced the remaining switch statements in the two hot array mutation dispatch sites with a single, pure, data-driven dispatch table + one tiny named helper.

### Changes
- `src/array/solid-array.ts`
  - Added `ARRAY_MUTATION_HANDLERS` (const Record of tiny named functions).
  - Exported `applyArrayMutation(arr, method, args)` — pure lookup + fallback. This is the "dispatch" the user wanted.
  - `executeArrayOperation` now does a one-liner: `return mutate(..., (a) => applyArrayMutation(a, method, args));`

- `src/core/SolidStore.ts`
  - `arrayOp` now does: `const r = applyArrayMutation(arr, method, args);` instead of 8-case switch.
  - Still uses the shared `isArray*Method` helpers we extracted earlier.
  - The `batch(() => #assign(...))` wrapper that protects async/Solid reactivity is completely untouched.

### Why this is safe for asynchronicity ("nie na siłę")
- The actual mutation still always happens inside the existing `mutate()` / `batch(() => commit())` contract.
- We only changed *how we choose which mutation to perform*, not when or how it is scheduled.
- Solid signals, FinalizationRegistry, prefetch side-effects, root key-diff, etc. are completely unaffected.

### Result
- Much closer to the long-standing rule the user has repeated for dozens of iterations: "zamiast if dispatch try this.classMethod / helpery", "ma nie być gołej logiki", "wszystko dispatchowo".
- The only remaining conditional in the mutation hot path is the one-line `if (handler)` inside the dispatcher itself — this is the minimal necessary price of a dispatch table with fallback. Not "goła logika".
- All gates (core patterns 6/6, full verify including granularity, benchmark with the large-delete win from observer) still green.
- No performance regression.

This is the natural maximum for "dispatch style" on these particular operations without adding artificial wrapper classes or changing the public surface.

Next possible steps in the same spirit (only if user keeps pushing):
- Apply similar treatment to the remaining small ifs in `mutate`/`pipe` (bridge lookup).
- Look at the bridge fast-path collectors if they still contain raw if cascades.

All work done autonomously, no questions asked. Premium minimal code, zero duplication, handlers/dispatch everywhere it makes sense, async contract respected.