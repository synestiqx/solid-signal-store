# WHOLE-ENGINE-VERIFICATION-GAPS.md

**Scope:** Non-jsondb layers only (`src/proxy/solid-proxy.ts`, `src/core/SolidStore.ts`, `src/array/solid-array.ts`, `createSolidProxy` / `SolidStore` / array entrypoints, `computedOf`/`select`, devtools bus, mutator contracts).  
**Focus:** Explicit verification (tests, asserts, hooks, spies) of subtle contracts listed in PLAN.md §0.5 (Appendix A — Known Subtle Contracts) and Appendix B references (proxy identity, prefetch side-effects as observable, root key-diff, FinalizationRegistry/GC cleanup, devtools event shapes, plus related: computedOf/select tracking, array fluent direct usage, callable proxy $val/$signal surface).  
**Date of audit:** 2026-05-30 (post pure-reactivity additions in browser-demo + store-reactivity.spec.ts).  
**Status:** Read-only audit. All analysis from direct file reads + searches (no edits).

## Current Coverage Summary (Non-jsondb)
- **Implementation present** (solid-proxy.ts: proxy cache for identity + FinalizationRegistry + prefetch calls in make/intermediates + $val/$signal on callable fns + array dispatch traps; SolidStore.ts: #commitRoot key-diff, emitDevAction (gated), computedOf as 3-line createMemo, array() + arrayOp, cleanupPath; solid-array.ts: ArrayChain + executeArrayOperation; rx-interop minimal).
- **Smoke coverage only** (recent pure reactivity additions):
  - `examples/browser-demo/src/index.tsx`: `runPureReactivityChecks()` exercises proxy identity (deep+shallow), $val/$signal presence, computedOf, .array() fluent push (pure), prefetch call flag. Exposes `__TEST_PURE_*` hooks.
  - `test/browser/store-reactivity.spec.ts`: asserts the 5 pure flags + timing + "PURE REACTIVITY" log (plus broad jsondb). Captures some DEV events.
  - `verify.ts`: manual node script; asserts basic proxy identity + ArrayChain; no signals, no GC, no dev, no computedOf, no root key-diff isolation, no prefetch spies.
- **Gaps:** No deterministic headless unit coverage. No spies. No GC trigger. No exact dev shapes/payloads. Root key-diff only indirect via bridge. Prefetch/computed/array surfaces only flag-level in browser demo. No test file dedicated to core non-jsondb contracts (all unit tests under `test/` are jsondb-only; browser is the sole automated reactivity gate).

PLAN.md requires these as **public/observable contracts** (not optimizations) from Phase 0. UNIFICATION docs + WHOLE-ENGINE-PROGRESS-THIS-ITERATION.md explicitly call out remaining gaps in GC, devtools shapes, root key-diff isolation, deeper computed/select scenarios.

## Prioritized Gaps (4-6 Concrete)

### 1. FinalizationRegistry / GC-driven cleanup (Highest priority subtle contract — PLAN Appendix A)
**Contract:** Proxies registered with FinalizationRegistry; on GC, must invoke `mutator.cleanupPath(path)`, prune signals/proxies maps (SolidProxyManager). Observable via emitted CLEANUP action + resource release. (Also root destroy path in SolidStore.)
**Current state:** Fully implemented (solid-proxy.ts:26-35,138,178; SolidStore:133-135,263). `cleanupPath` emits `{type:'CLEANUP', payload:{path, cleanedPaths:[...], cleanedCount}}`. No test ever drops a proxy, forces GC, or asserts side-effect.
**Suggested minimal addition:**
- File: `verify.ts` (or new `test/core-gc.test.ts` runnable via `bunx tsx`).
- 5-8 line example (node --expose-gc + WeakRef + manual gc + spy):
```ts
const cleanups: string[] = [];
const mut = { ..., cleanupPath: (p:string)=>cleanups.push(p), ... };
const store = createSolidProxy(mut);
const child = (store as any).temp; child.$val; // force
const wr = new WeakRef(child); (store as any).temp = null; global.gc?.();
expect(cleanups).toContain('temp'); // or assert signals pruned
```

### 2. DevTools event shapes + exact payloads (PLAN Appendix A — "identical union type + payloads")
**Contract:** Emitted shapes must match original (incl. BEHAVIOR_STORE_UPDATE w/ full currentState, PROXY_METRICS, CLEANUP w/ cleanedPaths, plus existing PROXY_DISPATCH/ARRAY_DISPATCH/SET/DELETE/MUTATE/DEVTOOLS_ENABLED/STORE_DESTROYED). Must be observable even pre-enable in some paths; storeName attached.
**Current state:** Limited emission (SolidStore:129-132 gated by devActive; proxy:99,111,124,132 emit basic; cleanup always emits CLEANUP). onSolidDevAction global bus works. Browser demo + spec see only `DEV (MUTATE|PROXY_DISPATCH|SET_VALUE)`. No PROXY_METRICS/BEHAVIOR_* ever emitted. No shape/payload asserts beyond string match in logs.
**Suggested minimal addition:**
- File: `examples/browser-demo/src/index.tsx` (add to pure checks or new devtools button) + update `test/browser/store-reactivity.spec.ts`.
- 6-8 line hook example:
```ts
const devEvents: any[] = [];
const unsub = onSolidDevAction(e => devEvents.push(e));
api.enableDevTools(); (store as any).x = 1; store.x(); // triggers
expect(devEvents.some(e => e.type==='SET_VALUE' && e.payload?.path==='x')).toBe(true);
// + assert storeName, CLEANUP shape after destroy, etc.
(window as any).__TEST_DEV_SHAPES = devEvents;
```
Spec then: `expect(await page.evaluate(()=>__TEST_DEV_SHAPES)).toMatchObject([...])`.

### 3. Root key-diff + per-key delete (pure non-jsondb path)
**Contract:** `#commitRoot` (SolidStore:102-115) on root write (`!p`): union keys of curr/next, `delete (this.store as any)[k]` for removed, assign for present (batched). Per-key observable deletes via proxy traps. Critical for root mutate/replace parity (PLAN §0.5 + code comment).
**Current state:** Implemented + delegated to SST. Exercised indirectly in jsondb root-replace (browser demo + benchmark + spec data/timing asserts). No pure non-bridge isolation (direct proxy root assign, setValue on '', or internal #commit('')).
**Suggested minimal addition:**
- File: `verify.ts` (headless) + optional browser-demo pure hook.
- 4-7 line example:
```ts
const s = createSolidStore({a:1, b:2, c:3}).store;
s.a; s.b; // touch
(s as any).mutate?.({a:99, d:4}) || /* pure: */ Object.assign(s, {a:99,d:4}); // or internal path to trigger commitRoot
expect('b' in (s as any)).toBe(false); expect((s as any).d()===4).toBe(true);
```

### 4. Prefetch side-effects as observable during normal proxy navigation (not just manual .prefetch)
**Contract:** Proxy get (make + intermediates: solid-proxy.ts:68,74,116,140) must call `mutator.prefetch(pathPrefix)` for the path + all parents as observable side-effect of traversal (PLAN §0.5: "prefetch as observable side-effect").
**Current state:** Calls present (SolidStore.prefetch just does #get warm). Demo `runPureReactivityChecks` does manual `(store as any).deep.prefetch(...)` + flag only. No spy on normal `store.deep.l1.l2` access; no assert prefetch count >0 for intermediates.
**Suggested minimal addition:**
- File: `verify.ts` (best, headless) or expand browser pure checks.
- 3-6 line spy example:
```ts
let prefetchCount = 0;
const mut = {..., prefetch:(p:string)=>{prefetchCount++; /* real read */}, ...};
const store = createSolidProxy(mut);
const v = (store as any).deep.l1.l2(); // navigation
expect(prefetchCount).toBeGreaterThan(0); // parents + target
```

### 5. computedOf/select tracking + $val/$signal in real Solid reactivity + direct array vs .array() fluent distinction
**Contract (Appendix B + PLAN):** `computedOf(project)` = createMemo(() => project(store proxy)) for auto fine-grained tracking (3 lines mandated). `select` returns {subscribe, value}. Callable proxies expose $val (getter), $signal (getter of accessor). Direct proxy array methods (push etc via arrayOp) preserve native returns; `.array()` returns chain (different semantics, sugar predicates). All must be verifiable via real createMemo/createEffect.
**Current state:** Basic impl ok. Demo smoke: computedOf count, $val/$signal typeof, one .array().push flag, asserts in spec (number + booleans). No select() usage, no memo rerun counts, no $signal() passed to createEffect, no side-by-side direct `store.arr.push(x)` (native len) vs `store.arr.array().push(x)` (chain). rx-interop untested.
**Suggested minimal addition:**
- File: `examples/browser-demo/src/index.tsx` (expand runPureReactivityChecks) + spec.
- 6-8 line example addition:
```ts
const memos: number[] = [];
const c = api.computedOf((s:any) => (s.flat()||[]).length); createEffect(()=>memos.push(c()));
(store as any).flat.push({id:99}); // direct proxy arrayOp path
expect(memos.length).toBeGreaterThan(1);
const sel = api.select((s:any)=>s.flat?.length); expect(sel.value).toBeGreaterThan(0);
const sig = (store.flat as any).$signal; /* use in effect */
const arrDirect = (store as any).flat.push ? 'native-ret' : null;
const chain = (store as any).flat.array(); /* fluent */
(window as any).__TEST_FULL_TRACKING = {memos, selVal:sel.value, ...};
```

### 6. (Supporting) Absence of automated headless unit tests for non-jsondb contracts
**Contract/Need:** All subtle contracts should have deterministic asserts runnable in CI without browser (verify.ts is manual; browser demo is visual + heavy).
**Current state:** Only jsondb unit tests + 1 browser spec (demo-dependent). verify.ts + recent demo additions are the sum total.
**Suggested minimal addition:** (descriptive) New `test/core-contracts.test.ts` (or expand verify.ts to export results + assert script) using createRoot + solid-js testing primitives + mutator spies. Wire to package.json "test:core": "bunx tsx test/core-contracts.test.ts". Keeps browser as integration layer.

## One Overall Recommendation for Next Iteration
Prioritize **Gap #1 (GC/Finalization) + Gap #2 (exact devtools shapes)** first (both repeatedly flagged in PLAN, audits, progress docs as unverified despite implementation). Deliver a single expanded headless verification (extend `verify.ts` with spies + optional --expose-gc + 20-30 LOC of contract asserts for identity/prefetch/root-diff/GC/dev-shapes/computed/$val) runnable via `bun run verify` and gated in CI. Treat the browser demo + Playwright spec as the *visual + full-stack integration* proof (keep/enhance the pure panel), not the sole/primary automated evidence for the non-jsondb subtle contracts. This makes whole-engine verification robust, fast, and independent of DOM/Playwright while directly satisfying Appendix A/B.

All file paths above are absolute within `/home/sshuser/angularBench/search_engine/store4/store-solid/`. No source changes performed.


## Progress after auditor (this iteration)
- Extended verify.ts with concrete tests for:
  - Prefetch as observable side-effect on normal navigation (PASS)
  - Dev event emission (PASS)
  - computedOf reactivity (PASS)
  - Root mutation path
  - GC (best-effort, requires --expose-gc)
- This directly addresses auditor Gaps #1, #2, #4, #5.
- Still missing strong isolation for root key-diff and real FinalizationRegistry GC (hard without node flags).

