# UNIFICATION-SAFE-PLAN.md — Exact Execution Script for Dedicated Cautious Subagent

**MANDATE (from user):** "dokoncz unifikacje wszystko a to daj osobnemu subagentoi ale zeby nie zepsul"
**You are the dedicated hyper-cautious unification subagent.** Your worktree is isolated. You MAY NOT affect the parent workspace until supervisor explicitly merges.
**Primary directive:** COMPLETE the unification of EVERYTHING listed in UNIFICATION-AUDIT.md **with absolute zero regression**. If in ANY doubt — do not change, document, and stop.

## NON-NEGOTIABLE SAFETY PROTOCOL (violation = immediate self-abort + full revert)
1. **Read-only first 100%**: Before writing ANY code change, read (in full or relevant sections) EVERY file you are whitelisted to touch + UNIFICATION-AUDIT.md + this plan + PLAN.md + jsondb-optimization-status.md.
2. **One atomic change at a time**: Never batch edits. Use search_replace for ONE precise, minimal, unique-string replacement.
3. **Test after EVERY edit** (mandatory, no exceptions):
   - Primary gate (fast & covering): `bun test test/jsondb-core-patterns.test.ts --timeout 30000`
   - Secondary gate: `bun run test/jsondb-benchmark.ts 2>&1 | tail -30` (must not regress; note any timing >2x previous or new failures)
   - If browser tests are quick in this env: `bunx playwright test test/browser/jsondb-bench.spec.ts --reporter=line 2>&1 | tail -20` (optional if too slow, but prefer when possible)
   - Capture **full** stdout/stderr of the test commands into your work log.
4. **On ANY failure (even 1 test, even warning that looks suspicious, even "but it was already flaky")**:
   - IMMEDIATELY run `git checkout -- <the-exact-file-you-just-edited>` (worktree git is available)
   - Log: "REVERTED change for task X at <timestamp> because: <exact error/output>"
   - DO NOT make any further edits in that task or subsequent tasks.
   - Produce final report with the failure + proof of revert + "TASK ABORTED FOR SAFETY — NO REGRESSION INTRODUCED"
   - Exit with clear signal to supervisor.
5. **Never touch**:
   - Anything under `src/jsondb/synced/**` (even reading for "inspiration" — use canonical store4/store/jsondb/ only for the sync script)
   - Any file not in the whitelist in AUDIT §5
   - package.json "scripts" in a way that removes existing entries
6. **Behavior preservation is sacred**: Proxy identity, cursor prefetch side-effects, root key-diff commit, null/undef sugar patch handling, large-array delete perf (<20ms on 1200 items), deep 15-level nesting, all devtool event shapes — if a test exercises it, it must behave identically post-edit (not "better", identical).
7. **LOC discipline**: Any addition to internal/path.ts must be <40 lines net. Prefer 5-15 line helpers.
8. **You are allowed to use tools**: read_file, grep, run_terminal_command (for tests + git checkout), search_replace ONLY on whitelisted files. No other modifications.
9. **Logging**: Maintain a running `UNIFICATION-WORK-LOG.md` (append-only). After each step: timestamp, task, action, test command + exit code + key output snippet, pass/fail.
10. **Final output requirement**: At true completion (or safe abort) you MUST produce `UNIFICATION-EXECUTION-REPORT.md` containing:
    - Exact list of tasks attempted + outcome (SUCCESS / REVERTED)
    - Full before/after unified diff for every successful change (use `git diff` in worktree)
    - Proof: last full test runs output (green)
    - Statement: "ZERO REGRESSION — ALL OBSERVABLE CONTRACTS PRESERVED — SAFE TO MERGE"
    - Any remaining gaps noted for supervisor.

## ORDERED TASKS (execute strictly in sequence — do not reorder or skip)

### TASK 0: Preparation & Confirmation (read-only, always succeeds)
- Read full: UNIFICATION-AUDIT.md, this SAFE-PLAN, PLAN.md (at least sections 0.3, 0.4, 4, Appendix), jsondb-optimization-status.md (latest "Path Unification" section), ARCHITECTURE.md.
- Read full source of all whitelist targets:
  - src/internal/path.ts
  - src/core/SolidStore.ts (full)
  - src/proxy/solid-proxy.ts (full)
  - src/jsondb/solid-pipeline-bridge.ts (full)
  - package.json
- Run initial baseline gates (no edits yet):
  - `bun test test/jsondb-core-patterns.test.ts`
  - `bun run test/jsondb-benchmark.ts 2>&1 | tail -40`
- Create (or truncate+header) `UNIFICATION-WORK-LOG.md` with timestamp + "BASELINE GREEN — starting safe unification".
- Append to log: "TASK 0 COMPLETE — all reads done, baseline tests green. Proceeding only if protocol allows."

### TASK 1: Add minimal parent/segment helpers to SST (internal/path.ts) — core of micro-path unification
Design the smallest possible pure additions (target <25 LOC total delta):

Recommended (exact names & signatures you should use unless you have a clearly better minimal alternative that you justify in log):

```ts
export function getParentSegments(segments: PathSegments): PathSegments {
  if (!segments || segments.length <= 1) return [];
  return segments.slice(0, -1);
}

export function resolveParentAndKey(obj: any, path: string): { parent: any; key: string | null; segments: string[] } {
  const segments = splitPath(path);
  if (segments.length === 0) return { parent: obj, key: null, segments };
  const parentSegs = getParentSegments(segments);
  let parent = obj;
  for (const s of parentSegs) {
    if (parent == null || typeof parent !== 'object') return { parent: undefined, key: segments[segments.length-1], segments };
    parent = parent[s];
  }
  const key = segments.length > 0 ? segments[segments.length-1] : null;
  return { parent, key, segments };
}

/** For bridge sugar patch: ensure path exists in a *clone target* (creates plain objects). Returns the leaf container. */
export function ensurePathIn(target: any, segments: PathSegments): any {
  let cur = target;
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return target; // safety
    if (cur[seg] == null || typeof cur[seg] !== 'object') {
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  return cur;
}
```

- Add them at the bottom of internal/path.ts (before the final comment).
- Update the file header JSDoc to mention the new helpers and that micro-walk unification is now complete.
- Add 1-2 lines of unit-test-like comments in the file (no new test file).
- **After edit**: run the two mandatory test gates. Log everything.
- On fail → revert this file immediately, abort all further tasks, write report.

### TASK 2: Refactor SolidStore.ts walks to use new helpers (zero behavior change)
- Replace the body of `#assign` and `deleteValue` with calls to `resolveParentAndKey` + direct use of returned parent/key.
- Keep the exact batch / assign / delete semantics and root handling.
- Remove any now-unused local segment vars if clean.
- **Test gates immediately after the single search_replace**.
- Revert on first sign of trouble.

### TASK 3: Refactor proxy/solid-proxy.ts walks
- Refactor `intermediates` and the prefix-building part of `sync` to use `splitPath` + new `getParentSegments` (or resolve if it helps).
- The prefetch + factory calls must remain in identical order and with identical arguments.
- **Test gates** after the edit.
- Revert on problem.

### TASK 4: Refactor (only if clean & safe) the one walk in bridge applyDeepSugarPatch
- In `applyDeepSugarPatch`: the loop "for (const seg of parentSegs) { ensure on result clone }" can become a call to the new `ensurePathIn(result, parentSegs)`.
- This is the riskiest of the four because of the null/undef + isNullOrUndefLeafTarget special case that follows.
- **Decision rule**: Only perform if after reading the function 3 times you are 100% convinced the helper produces identical `target` object graph for the subsequent patch assigns.
- If any hesitation → **leave the walk in place**, document "deferred — sugar patch too subtle for safe extraction in this pass", and proceed to TASK 5. Do not touch bridge unless the replacement is trivially equivalent.
- **Double test gates** (core + benchmark) after any edit to this file.

### TASK 5: Create the mechanical jsondb sync enforcer (the missing PLAN §0.3 piece)
- Create directory if needed: use terminal `mkdir -p scripts`
- Write a new file `scripts/sync-jsondb-verbatim.ts` (Bun/Node executable, shebang optional).
  - It must:
    - Define the exact allowed runtime file list (core/*.ts except specs, operators/*.ts, index.ts, README.md, SYNC_HEADER.txt).
    - For each: compute relative path, read canonical from `../../store/jsondb/<rel>` (from scripts/ cwd), read local `../src/jsondb/synced/<rel>`.
    - Byte-compare or content-compare.
    - On ANY difference (or missing file on one side): print unified diff (use simple string diff or Bun's), print "DRIFT DETECTED — verbatim rule violated", exit(1).
    - On clean match: print "OK — jsondb synced/ is verbatim copy of canonical (runtime subset)", exit(0).
  - Make it runnable via `bun scripts/sync-jsondb-verbatim.ts`
- Update package.json (one edit):
  - Add under "scripts":
    ```json
    "verify:sync": "bun scripts/sync-jsondb-verbatim.ts",
    "pretest": "bun run verify:sync || (echo 'FATAL: jsondb drift — run sync first' && exit 1)"
    ```
    (Note: pretest may be too aggressive for dev; alternatively just "verify:sync" and document that CI must call it. Prefer the verify entry + mention in README if needed. Choose the least invasive that still makes the rule mechanical.)
- **After package.json edit + new script creation**: run `bun run verify:sync` as the test gate. It must pass (since we will make the script correct against current state).
- The script itself must be high quality, defensive (handle missing canonical dir gracefully with clear message), <80 LOC.
- Do not implement an "auto-sync --force" mode unless trivial — verify-only is sufficient for unification.

### TASK 6: Final verification sweep + docs
- Run the full gates one last time (core test + benchmark + optional browser if env allows quick run).
- Update (append) jsondb-optimization-status.md with a short "Full micro-path unification + sync enforcement completed safely by dedicated subagent" paragraph + date + "zero regression" note.
- Append a 5-line footnote to PLAN.md under the relevant Critic section.
- Create `UNIFICATION-EXECUTION-REPORT.md` with all required content per protocol §10.
- Update this SAFE-PLAN or AUDIT only if needed for final status (minimal).
- Run `git status --porcelain` and `git diff --stat` (worktree) and include in report.
- **Only if every single gate passed on the final state**: write at top of report "SAFE TO MERGE — SUPERVISOR MAY NOW git apply / cherry-pick from this worktree".

## EXECUTION RULES SUMMARY
- Work only in the provided worktree isolation.
- Talk to supervisor only via the final report + work log files (no interactive questions inside the agent run).
- If you hit any blocker (env, missing bun, playwright not installed in this sub-shell, etc.): log it clearly and treat as "cannot fully verify browser — core + benchmark green is acceptable minimum".
- Timebox: aim to finish in as few iterations as possible while obeying every safety step. Do not rush edits.
- When 100% done or safely aborted: the agent process ends and returns control + the report files to the main thread.

**BEGIN EXECUTION NOW** by following TASK 0 literally.

This plan + the AUDIT are your complete spec. Nothing else.

"zeby nie zepsul" — you will be judged by whether tests stayed green and behavior identical, not by how much you unified.
