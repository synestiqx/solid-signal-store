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
export declare function applyPipelineMutation(ops: any[], currentValue: unknown, options?: SolidPipelineOptions): unknown;
/**
 * Like applyPipelineMutation, but also reports which leaf paths (relative to the
 * branch) actually changed — for the host's fine-grained ("grained") wake. Only
 * the flat array + non-deep criteria + string-key value-action shape is precise;
 * everything else returns mutations:null so the caller keeps today's commit. The
 * path computation is the shared engine helper, identical to the Angular host.
 */
export declare function applyPipelineMutationDetailed(ops: any[], currentValue: unknown, options?: SolidPipelineOptions): DetailedMutationResult;
export declare function createPipeline(currentValue: unknown, ops: any[], options?: SolidPipelineOptions): PipelineWrapper<any>;
export declare const solidJsnqBridge: SolidJsnqBridge;
export declare function registerSolidJsnqBridge(target?: any): SolidJsnqBridge;
