# Iteration — Full Engine Wakeup/Tracking Refactor (Handlers + Granularity Evidence)

**Focus (per user):** "cały silnik nie tylko jsnq", "refraktor calego silnika", "ma nie byc golej logiki", "wszystko helpery", continue to end without questions. Scheduled 40min-style run.

## Concrete Progress (whole engine, wakeup layer)

### 1. Proxy Handler Cleanup (solid-proxy.ts)
- `walkParentPaths` fully rewritten to reuse SST `getParentPath` (from internal/path.ts) in a loop — eliminated all manual string concat / segment building "goła logika".
- New focused `makeChildPath(parent, key)` helper — all child path construction (`${path}.${k}`) now centralized in one place (handleSet, handleDelete, get trap, dispatch). No more duplicated templates.
- `createDispatchHandler` now uses `getParentPath(cp)` instead of inline split/slice/join.
- Extended `specialValueProps` dispatch table to cover `length` — removed last direct `if (ks === 'length')` in hot get trap.
- All changes preserve exact prior semantics + proxy identity + prefetch contracts.
- Root creation path already 100% via `createBaseCallable` + `createProxyHandler` + `registerProxy` (no special hacks).

Result: `sync()` stays 2 lines delegating to `wakeExact` + `currentWakeStrategy`. Every special case and parent walk is a named class method or dispatch table entry.

### 2. Granularity Verification Strengthened (verify.ts + hook)
- Added `_onSignalUpdate` test hook to `SolidProxyOptions` (zero prod impact).
- Wired in `updateSignal` — real observation of dirtied paths.
- Replaced broken prototype monkey-patch with clean option-based collector.
- Now asserts measurable difference:
  - grained (default): exactly 1 (the leaf `a.b.c`)
  - container (via runtime `_wakeParentsOnChange` / `wakeUp`): 3 (leaf + parents `a`, `a.b`)
- Test passes and prints: `✅ wakeUp granularity works (grained=1 [...], container=3 [...])`
- Directly proves `store.wakeUp('grained' | 'container')` (and SolidStore impl) has the documented effect on wakeup behavior.

This is the "minimal but real demonstration" + evidence requested in todos.

### 3. Full Stable Verification Gate (no regression)
- `bun run verify:sync` → ✅ verbatim identical (26 files)
- `bun test/jsnq-core-patterns.test.ts` → 6/6 passed
- `bun test/jsnq-benchmark.ts` → all cases ✅ (incl. large-delete, root-replace, deep)
- `bun run verify` → all extended contracts ✅ + new granularity assertion ✅
- Zero breakage on proxy identity, prefetch side-effects, computedOf tracking, root key-diff, array fluent, dev events, GC wiring.

## Relation to Original Vision (solidjs.md)
- Default remains maximum Solid-native fine-grained (only changed leaf signal dirtied; Solid does the rest via its tracking).
- Runtime `wakeUp('container'/'parents')` available exactly as specified for cases needing broader invalidation.
- Systematically removed manual "bump ancestor" style logic in favor of simple flag + Solid signals — lighter than the Angular VersionBumpScheduler + DependencyTracker ancestor walk.
- All via named helpers / dispatch (no if-dispatch naked logic).

## State
Premium, handler-based, unified (SST path.ts), fully verified. Ready for any next layer (more browser demo evidence of wake modes, logger extraction, etc.) if continued.

All work done autonomously. No user questions asked during the phase. "kontynuuj" honored to completion of this iteration's todos.

**Gates:** all green. No regressions on entire engine.
