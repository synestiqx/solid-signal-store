# UNIFICATION-AUDIT.md — Remaining Duplication & Unification Opportunities (post simple-path SST)

**Date:** current (post dedicated path-unification subagent for simple dot-path layer)
**Context:** store-solid per PLAN.md v2 (Critic-hardened). internal/path.ts is SST for normalize/split/getBy* /setBy*/parent/cloneJson. All core consumers delegate. synced/ verbatim (27 files, no enforcement script yet).

**Goal of this audit (for "unifikacje wszystko"):** Identify EVERY remaining opportunity for deduplication / single-source that can be done with **zero regression risk** and **strict respect for budgets + PLAN rules** (no new files except the approved sync enforcer script + minimal additions to internal/path.ts; no edits to synced/).

## 1. COMPLETED (do NOT touch again)
- Simple dot-path layer: normalizePath, splitPath, getByPath, setByPath, getParentPath, cloneJson, getBySegments → fully in src/internal/path.ts as THE SST.
- Delegations confirmed (no local reimpls):
  - utils/path-utils.ts (thin adapter, preserves API)
  - core/SolidStore.ts (all #get/#set/#clone + split in walks)
  - jsnq/solid-pipeline-bridge.ts (getBySegments + cloneJson in fast paths + sugar)
  - proxy/solid-proxy.ts (only splitPath for intermediates/sync)
- Re-export: InternalPath from index.ts
- Zero regression proven in prior runs (core patterns 6/6 + full browser Playwright with data asserts + perf screenshots + large delete + root ops).

## 2. REMAINING HIGH-VALUE, LOW-RISK UNIFICATION TARGETS (P0 for this task)

### 2.1 Micro path traversal duplication (segment walking to parent/last-key) — HIGHEST PRIORITY for "unifikacje wszystko"
Locations with **near-identical 3-8 line** "walk segments, handle prefix, get parent ref + key" logic:
- **core/SolidStore.ts**:
  - `#assign(p, v)` (lines ~95-101): walk segs to parent node then assign last
  - `deleteValue(path)` (~146-150): identical walk pattern for delete
- **proxy/solid-proxy.ts**:
  - `intermediates(...)` (~61-69): prefix walk + factory + prefetch
  - `sync(changed)` prefix build loop (~48-58)
- **jsnq/solid-pipeline-bridge.ts**:
  - `applyDeepSugarPatch(...)` (~323-332): walk `parentSegs` on the *cloned result* to build/ensure target for patch assign + null/undef special case handling

**Impact:** ~20-25 lines of nearly-duplicate traversal. Extracting 2-3 pure helpers to internal/path.ts (e.g. `getParentSegments`, `resolveParentAndKey`, optional `ensureSegments` for creation-in-clone) removes the last path-related dupe while keeping behavior 100% identical.
**Risk:** Very low if helpers are pure + covered by existing tests (sugar patch, root commits, proxy deep gets/sets, array filtered updates, deleteValue paths all exercised in jsnq-core-patterns + browser specs + benchmark).
**Budget:** Adding <30 LOC to internal/path.ts still keeps overall layer tiny.
**Rule:** Must preserve exact root/empty path / null / undef semantics of each callsite.

### 2.2 Missing mechanical sync enforcement for jsnq verbatim copy (PLAN.md v2 §0.3 — CRITICAL GAP)
- No `scripts/` dir.
- No sync script (e.g. `sync-jsnq-verbatim.ts` or .sh) that:
  - Compares the *runtime* subset of `src/jsnq/synced/{core,operators,index.ts,README.md}` against canonical `store4/store/jsnq/` (ignore examples/, *.spec.ts, bckup/).
  - Fails hard (exit 1) + prints unified diff on ANY content or structural drift.
  - Optionally auto-copies with header stamp on explicit "sync" command (but default = verify only).
- package.json has no "verify:sync", "test:jsnq-parity" or pre-test step invoking it.
- Result: the "verbatim + only bridge allowed" rule is documented but **not mechanically enforced** today. This is incomplete unification of the "zero duplication of jsnq logic" mandate.

**Action:** Create minimal enforcer + wire it. This is pure infra (no behavior change to store). Safe.

### 2.3 Minor repeated constant / list duplication (nice-to-have, only if fits time)
- Hardcoded array method lists appear in 2 places:
  - SolidStore.arrayOp query/mutate lists
  - solid-array.ts (executeArrayOperation + q lists)
- Can become `export const ARRAY_QUERY_METHODS = [...]` etc in array/ or a 5-line `src/internal/array-ops.ts` (but only if <10 LOC net win and doesn't violate "no extra folders" spirit).
- Low priority — leave unless trivial 1-line const shared in existing array file.

### 2.4 Bridge fast-path sprawl (mentioned in status as "further reduction of special cases")
Many specialized if-branches (root replace, flat where+update sugar, insert, delete_key, deep sugar null handling, fallback).
These are **performance-critical hot paths** (validated by benchmarks + browser large-array 1200+ tests).
**Unification here is HIGH RISK** — any merge of logic can regress perf or change edge (null, root, sugar patch on deep).
**Decision for subagent:** ONLY touch if an *obvious, tiny, behavior-preserving* extraction (e.g. a 3-line `isSafeUpdateAction` predicate) that doesn't alter control flow. Prefer "do nothing" over clever refactor. If in doubt, skip and document "deferred for perf safety".

### 2.5 Other (none significant)
- Dev emit / listener set: already minimal global in SolidStore.
- GC FinalizationRegistry: isolated in proxy manager.
- computedOf / select: 3 lines as mandated.
- No other repeated complex algorithms.

## 3. OUT OF SCOPE / FORBIDDEN (per user + PLAN)
- Any edit under `src/jsnq/synced/` (verbatim forever; only the future sync script may read/compare).
- New folders (reactivity/, computed/ etc.).
- New files except: the sync script (in scripts/ or root as `scripts/sync-jsnq-verbatim.ts`) + updates to package.json + docs.
- Any change that increases LOC beyond hard caps without immediate Critic review.
- Performance "optimizations" that are not pure extractions.
- Touching browser demo, playwright specs, or benchmark unless a test-only helper is required for verification (avoid).

## 4. Success Criteria for "unifikacje wszystko" (this hand-off)
- internal/path.ts contains the last micro-walk helpers; all 5+ callsites delegate; no inline segment walks left for parent/key logic.
- Sync enforcer script exists + wired in package.json + `bun run verify:sync` (or equivalent) fails cleanly on intentional drift and passes on clean state.
- All existing tests + browser specs + benchmark still 100% green (exact same timings within noise, same screenshots artifacts if re-run).
- Zero observable behavior change (proxy identity, prefetch side effects, root key-diff, sugar patch null handling, large delete perf, deep nesting etc. all identical).
- Updated docs (this audit + status + PLAN footnote) + a UNIFICATION-EXECUTION-REPORT.md produced by the subagent with before/after LOC, exact test outputs, and "SAFE — ZERO REGRESSION" stamp.
- Subagent must have followed the strict protocol in UNIFICATION-SAFE-PLAN.md (read first, one-edit-at-a-time, test-after-each, revert-on-first-fail).

## 5. Files Approved for Touch (whitelist for subagent)
1. src/internal/path.ts (add 2-4 tiny pure helpers + JSDoc)
2. src/core/SolidStore.ts (replace 2 walks with helper calls)
3. src/proxy/solid-proxy.ts (replace 2 walks with helper calls)
4. src/jsnq/solid-pipeline-bridge.ts (replace 1 walk with helper if it fits cleanly; else leave)
5. package.json (add 1-2 script entries)
6. New: scripts/sync-jsnq-verbatim.ts (or .js if preferred; ~40-60 LOC max, pure Node/Bun fs + diff)
7. Docs only: UNIFICATION-AUDIT.md (update status), jsnq-optimization-status.md (add entry), PLAN.md (footnote), UNIFICATION-SAFE-PLAN.md (if needed), and the execution report.

Any other file = immediate abort + revert.

**This audit is the input for the dedicated safe subagent.** Execute only what is listed here, nothing more ambitious.

"kurwa zrob to do konca ale zeby nie zepsul" — safety first, completeness second.
