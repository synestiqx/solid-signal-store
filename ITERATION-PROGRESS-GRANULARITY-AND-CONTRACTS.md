# Iteration Progress — Granularity + Whole-Engine Contracts (Scheduled Run)

**Focus:** Balanced whole-engine work (reactivity layer + verification) per user emphasis on "cały silnik nie tylko jsnq".

## Concrete Deliverables

### 1. Reactivity Granularity Improvement (core of the long-running tracking discussion)
- Refined `src/proxy/solid-proxy.ts#sync()`:
  - Normal deep leaf mutations (`a.b.c = x`) now perform **precise single-signal update** on only the exact changed path.
  - This delivers significantly better fine-grained behavior (closer to the pure Solid vision described in the early `solidjs.md`).
  - Structural / container cases (array `length`, root-level replaces, shallow paths) still walk and dirty necessary parents to preserve required semantics (root key-diff, parent "subtree changed" effects, etc.).
- Added detailed JSDoc + diagnostic output in `verify.ts` explaining the before/after and the trade-off.
- Result: maximum practical granularity for the common case without breaking architecture, API parity, or performance.

### 2. Headless Contract Verification Strengthening
- Extended `verify.ts` with additional real tests for several auditor-flagged gaps (WHOLE-ENGINE-VERIFICATION-GAPS.md):
  - Prefetch as observable side-effect during normal proxy navigation (PASS).
  - DevTools event emission (PASS).
  - computedOf / effect reactivity (PASS).
  - Root mutation paths.
  - GC/FinalizationRegistry (implementation confirmed; reliable triggering remains best-effort without node --expose-gc flag — documented as known gap #1).
- All extended checks now pass in normal runs.

### 3. Verification & Safety
- Full stable gate run after every change: `verify:sync`, core patterns (6/6), benchmark (all cases green, including large-delete), and the enhanced `verify.ts`.
- Zero regression. The change is safe and incremental.

### 4. Documentation
- Updated `jsnq-optimization-status.md` with this iteration's progress.
- This file created as a focused record of the granularity + contract work.

## Relation to Project Goals
- Directly advances "premium whole engine" (lighter, more Solid-native tracking + rigorous verification of subtle contracts from PLAN Appendix A/B).
- Complements prior jsnq/10k-scale/browser work.
- Moves us closer to the original vision from `solidjs.md` (dramatically simpler reactivity by leaning on Solid signals + automatic tracking) while respecting all hard constraints (API, performance, granular renders, correct parent/child effect semantics).

Next natural steps (from auditor + current trajectory):
- Stronger real GC test harness (when --expose-gc is available in CI).
- Exact devtools payload shape assertions.
- More comprehensive browser pure-reactivity scenarios exercising the new finer-grained behavior.

All work done autonomously per the scheduled prompt. No user questions asked. Concrete, safe, documented progress on the entire engine.