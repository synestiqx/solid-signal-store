/**
 * solid-pipeline-bridge.ts
 * Thin Solid integration layer under jsnq/.
 *
 * Reusable JSNQ logic is imported from jsnq.
 * This bridge may differ; shared data-engine is exported through jsnq/data-engine.
 *
 * Every reusable fast path now lives in the shared library
 * (synced/core/pipeline-fastpath.ts): the flat-array where+actions COW engine,
 * the single-action structural shortcuts (root insert, flat delete_key,
 * insert_to-inside-array COW spine) and the sugar deep patch. The bridge keeps
 * only what is genuinely Solid-specific: the root-replace shortcut (Solid
 * reactivity wants a fresh deep reference) and the defensive full-pipeline
 * fallback that never throws into the reactive graph.
 */

import { PipelineWrapper } from '@adsq/jsnq/core/pipeline-wrapper';
import { cloneJsonData as cloneJson } from '@adsq/jsnq/core/data-engine';
import {
  applyDeepSugarPatch,
  collectPipelineIntent,
  isDeepSugarAction,
  tryFastPipelineMutation,
  tryFastStructuralMutation,
} from '@adsq/jsnq/core/pipeline-fastpath';

export interface SolidPipelineOptions {
  isRoot?: boolean;
  path?: string;
  /**
   * How the bridge reacts to an execution error.
   *  - 'warn' (default): log a warning and return a safe clone — never throws into
   *    the reactive graph. This is the historical behaviour (unchanged default).
   *  - 'silent': return a safe clone without logging.
   *  - 'throw': rethrow so callers (typically dev) see the real error instead of a
   *    silent no-op (e.g. moveTo('bad.target') becoming a swallowed warning).
   */
  bridgeErrorMode?: 'throw' | 'warn' | 'silent';
  /** Collect per-match operation strings only while development diagnostics are active. */
  trackOperations?: boolean;
}

export interface SolidJsnqBridge {
  applyPipelineMutation: typeof applyPipelineMutation;
  applyPipelineMutationDetailed: typeof applyPipelineMutationDetailed;
  createPipeline: typeof createPipeline;
}

export interface DetailedMutationResult {
  /** New branch value (identical to applyPipelineMutation's return). */
  value: unknown;
  /**
   * Affected paths RELATIVE to the mutated branch (e.g. "0.profile.name"), enabling
   * the host to wake exactly those leaves instead of the whole branch. `null` when
   * precise wake is not applicable (structural ops, deep `@`, sugar patches, root,
   * nested-candidate criteria) — the caller MUST fall back to a normal commit.
   */
  mutations: string[] | null;
}

export function applyPipelineMutation(
  ops: any[],
  currentValue: unknown,
  options: SolidPipelineOptions = {}
): unknown {
  if (!ops || ops.length === 0) return currentValue;

  const errorMode = options.bridgeErrorMode ?? 'warn';

  try {
    const isRoot = options.isRoot ?? !options.path;

    // Strong fast path for root-level replace (very common)
    if (isRoot && ops.length === 1) {
      const op = ops[0];
      if (op && typeof op === 'object' && !op.__isMutation) {
        return cloneJson(op);
      }
      if (op && op.__isMutation) {
        if (op.type === 'replace' && (typeof op.key === 'undefined' || op.key === '' || op.key === null)) {
          const val = typeof op.value === 'function' ? op.value(currentValue) : op.value;
          return cloneJson(val);
        }
        // Also handle raw replace object at root
        if (op.type === 'replace' && typeof op.key === 'object') {
          return cloneJson(op.key);
        }
      }
    }

    // === Ultra-fast path: flat array + where + value actions (shared COW engine) ===
    const fast = tryFastPipelineMutation(currentValue, ops, { collectAffectedPaths: false });
    if (fast) return fast.value;

    const intent = collectPipelineIntent(ops);

    // === Shared single-action structural shortcuts (insert / delete_key / insert_to COW) ===
    const structural = tryFastStructuralMutation(currentValue, intent);
    if (structural) return structural.value;

    // === Sugar deep update (where + update({patch})) on object trees ===
    // Not representable in the raw pipeline; shared helper is the canonical semantics.
    if (intent.criteria.length > 0 && intent.actions.length > 0 && intent.actions.every(isDeepSugarAction)) {
      return applyDeepSugarPatch(currentValue, intent.criteria, intent.actions);
    }

    // === Fallback: standard ops that the original pipeline handles correctly ===
    // (e.g. update('some.key', valOrFn), replace, deletes, complex multi-op, moves etc.)
    // Wrapped defensively to guarantee no crashes even on unexpected null/undefined
    // edge cases that reach here (sugar forms with non-string keys are pre-routed).
    try {
      const wrapper = new PipelineWrapper(currentValue as any, {
        autoClone: true,
        trackOperations: options.trackOperations ?? false,
      });
      wrapper.pipeline(...(ops as any));
      wrapper.execute('all');
      return wrapper.data;
    } catch (execErr) {
      if (errorMode === 'throw') throw execErr;
      if (errorMode !== 'silent') {
        console.warn('[solid-pipeline-bridge] Execution warning (standard path):', execErr);
      }
      // Return a structurally-safe clone on error (never original ref, never throw).
      // Preserves nulls; undefined props may be dropped (json-like semantics).
      return cloneJson(currentValue as any);
    }
  } catch (e) {
    if (errorMode === 'throw') throw e;
    if (errorMode !== 'silent') {
      console.error('[solid-pipeline-bridge] Pipeline execution failed:', e);
    }
    // Top-level safety (warn/silent): never throw from the bridge.
    return cloneJson(currentValue as any);
  }
}

/**
 * Like applyPipelineMutation, but also reports which leaf paths (relative to the
 * branch) actually changed — for the host's fine-grained ("grained") wake. Only
 * the flat array + non-deep criteria + string-key value-action shape is precise;
 * everything else returns mutations:null so the caller keeps today's commit. The
 * path computation is the shared engine helper, identical to the Angular host.
 */
export function applyPipelineMutationDetailed(
  ops: any[],
  currentValue: unknown,
  options: SolidPipelineOptions = {}
): DetailedMutationResult {
  if (ops && ops.length > 0) {
    const fast = tryFastPipelineMutation(currentValue, ops);
    if (fast) return { value: fast.value, mutations: fast.affectedPaths };
  }
  return { value: applyPipelineMutation(ops, currentValue, options), mutations: null };
}

export function createPipeline(currentValue: unknown, ops: any[], options: SolidPipelineOptions = {}) {
  const hasMutations = collectPipelineIntent(ops).actions.length > 0;
  const wrapper = new PipelineWrapper(currentValue as any, {
    autoClone: hasMutations,
    trackOperations: options.trackOperations ?? false,
  });
  if (ops && ops.length > 0) {
    wrapper.pipeline(...(ops as any));
  }
  return wrapper;
}

export const solidJsnqBridge: SolidJsnqBridge = {
  applyPipelineMutation,
  applyPipelineMutationDetailed,
  createPipeline,
};

export function registerSolidJsnqBridge(target: any = globalThis): SolidJsnqBridge {
  target.__SOLID_PIPELINE_BRIDGE = solidJsnqBridge;
  target.solidJsnqBridge = solidJsnqBridge;
  return solidJsnqBridge;
}

// Optional side effect for `import "solidstore/jsnq"`.
registerSolidJsnqBridge();
