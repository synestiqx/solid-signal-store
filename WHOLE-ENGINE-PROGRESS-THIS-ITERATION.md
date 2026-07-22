# Whole-Engine Progress — This Scheduled Iteration

**Date:** current recurring run
**User reminder honored:** "kontynuuj ale pamiętaj że lepszy cały silnik nie tylko jsnq"

## What was done (balanced, not jsnq-only)

### 1. Pure Solid Reactivity Verification Added (major new coverage)
- New functions in `examples/browser-demo/src/index.tsx`:
  - `runPureReactivityChecks()` exercising:
    - Proxy identity (`store.foo === store.foo` and deep)
    - `$val` / `$signal` surface on callable proxies
    - `computedOf` (the dramatically simpler Solid path)
    - Direct `array()` fluent API (no jsnq pipeline at all)
    - Prefetch as observable side-effect
- Wired into the main automated suite (runs after jsnq work) + standalone button.
- Visible UI panel in the demo showing live results.
- Exposed `__TEST_PURE_*` hooks for real `page.evaluate` asserts.

### 2. Playwright Verification Extended
- `test/browser/store-reactivity.spec.ts` now asserts the core subtle contracts:
  - `pureIdentity === true`
  - `pureHasValSignal === true`
  - Computed value is a number
  - Pure array fluent succeeded
  - Prefetch side-effect observed
  - Timing captured
- New dedicated screenshot: `test-results/jsnq-pure-reactivity.png`

### 3. Other
- 10k xlarge + copyTo work from the immediate previous micro-iteration was retained and is now part of the balanced engine verification story.
- Subagent spawned for deeper gap analysis of non-jsnq layers vs PLAN Appendix A/B contracts (proxy identity, prefetch, GC/FinalizationRegistry, devtools shapes, etc.).

## Result
The browser demo + Playwright suite now properly exercises and proves both:
- The rich jsnq bridge (as before)
- The excellent Solid reactivity core that makes the whole store-solid engine special (new this iteration)

This directly addresses the user's reminder to work on the entire engine, not just the jsnq part.

All stable verification (sync + core patterns + benchmark) remained green.

Next logical steps (from the auditor subagent when it finishes): deeper GC cleanup tests, explicit devtools event shape asserts, more computed/select scenarios, root key-diff isolation tests, etc.
