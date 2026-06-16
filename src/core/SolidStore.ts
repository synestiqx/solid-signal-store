/**
 * SolidStore.ts — single central orchestrator (CreateStore + SignalStore parity).
 * Wires createSolidProxy + narrow StoreMutator. Real in-memory root.
 * Jsondb bridge dispatch for mutate/pipe (future solid-pipeline-bridge).
 * Full public surface, headless/vanilla, batch(), zero logic dupe (proxy/bridge own theirs).
 * Per PLAN.md v2 + Critic: minimal, clean, contracts (proxy identity, prefetch, root key-diff, dev shapes, cleanup).
 */

import { batch, createMemo, type Accessor } from 'solid-js';
import {
  createSolidProxy,
  type SolidWakeMode,
  type StoreMutator,
  type SolidProxyOptions,
} from '../proxy/solid-proxy';
import { createArrayChain, ARRAY_QUERY_METHODS, ARRAY_MUTATION_METHODS, applyArrayMutation } from '../array/solid-array'; // clean top-level import (premium wiring) + shared method sets + pure dispatch (max dispatch style, no switches)
import {
  cloneJsonData,
  createJsonPathPlan,
  createMutationResult,
  deleteJsonPath,
  readJsonPath,
  writeJsonPath,
  type JsonMutationResult,
} from '@synestiqx/jsondb/data-engine';
import { createProjectionObservable, type ProjectionObservableOptions } from './rx-interop';
import type { SolidJsondbBridge } from '../jsondb/solid-pipeline-bridge';
import type { SolidStoreProxy } from './proxy-types';

// --- Minimal local contracts (no reliance on incomplete synced types) ---

/**
 * opinia5: reactive jsondb query handle. Callable for the current result, `.subscribe()` for a
 * push subscription (reuses the rx-interop projection observable), `.dispose()` to release the
 * per-query branch interest. Same `where(...)` DSL as `mutate`.
 */
export type SolidLiveQuery<T> = (() => T) & {
  subscribe(
    cb: (value: T) => void,
    options?: ProjectionObservableOptions<T>
  ): { unsubscribe(): void; dispose(): void };
  dispose(): void;
};

export interface SolidStoreOptions {
  strict?: {
    invalidPath?: boolean;
    deleteUndefined?: boolean;
    rootRxjs?: boolean;
  };

  /**
   * Controls whether changing a deep value also dirties parent signals on the path.
   *
   * - false (default): Fine-grained mode (recommended). Only the exact changed path is dirtied.
   *   Gives maximum Solid-native granularity and performance.
   *
   * - true: Container/wake-parents mode. Parents on the path are also dirtied.
   *   Useful if you have legacy code that expects parent memos/effects to fire on any deep change.
   */
  wakeParentsOnChange?: boolean;

  // future: dependencyMode, cloneStrategy etc for parity
  jsondbBridge?: SolidJsondbBridge;

  /**
   * How the jsondb bridge reacts to a mutation execution error.
   *  - 'warn' (default): log + safe no-op clone (historical behaviour, unchanged).
   *  - 'silent': safe no-op clone without logging.
   *  - 'throw': surface the real error (recommended in development).
   */
  bridgeErrorMode?: 'throw' | 'warn' | 'silent';

  /**
   * Fine-grained wake for `mutate()` (opt-in; default false = historical behaviour).
   *
   * When false, `mutate(path, where(...), update(...))` commits the whole branch
   * (waking every observed descendant of `path`). When true, for the flat
   * array + value-action shape the store wakes only the leaves that actually
   * changed (e.g. `users.0.profile.name`) plus the branch signal itself and any
   * branch subscribers ($liveQuery) — honoring the same `grained` axis used
   * everywhere else. Falls back to the branch commit for structural/deep ops.
   */
  preciseMutationWake?: boolean;
}

export type StoreDevToolsAction = {
  type: string;
  payload?: Record<string, unknown>;
  storeName?: string;
};

type DevListener = (e: StoreDevToolsAction & { storeName?: string }) => void;
const GLOBAL_WAKE_MODES = new Set<SolidWakeMode>(['grained', 'fine', 'exact', 'container', 'parents', 'leaf', 'branch']);

// Global dev bus (parity with original DevToolsActionSubject / emit patterns)
const devListeners = new Set<DevListener>();
function emitDev(ev: StoreDevToolsAction & { storeName?: string }) {
  for (const fn of devListeners) {
    try { fn(ev); } catch { /* isolated */ }
  }
}
export function onSolidDevAction(fn: DevListener): () => void {
  devListeners.add(fn);
  return () => devListeners.delete(fn);
}

// Named store registry (useSolidStore + createStore(name) parity with SignalStore)
const registry = new Map<string, SolidStore<any>>();

// --- Orchestrator ---

export class SolidStore<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly store: SolidStoreProxy<T>; // the callable proxied reactive root (full surface via traps)
  private readonly data: T;
  private name: string;
  private devActive = false;
  private readonly opts: SolidStoreOptions;

  constructor(initial: T, name = 'default', opts: SolidStoreOptions = {}) {
    this.name = name;
    this.opts = opts;
    this.data = this.#clone(initial ?? ({} as T));

    const mutator = this as unknown as StoreMutator & Record<string, any>;
    const initialWakeParents = opts.wakeParentsOnChange ?? false;

    // Set initial mode on the mutator so the proxy can read it dynamically
    (mutator as any)._wakeParentsOnChange = initialWakeParents;

    const pOpts: SolidProxyOptions = {
      strictInvalidPath: opts.strict?.invalidPath,
      strictDeleteUndefined: opts.strict?.deleteUndefined,
    };
    this.store = createSolidProxy<SolidStoreProxy<T>>(mutator, pOpts);

    registry.set(name, this);
  }

  // --- Path orchestration (delegates to unified internal primitives) ---
  // Eliminates previous inline duplication. Root (empty path) semantics preserved.
  // All core files (bridge, SolidStore, PathUtils, proxy) delegate to src/internal/path.ts
  // as the clear single source of truth (SST) for simple path logic — unification COMPLETE (Critic P0 + micro-walk P1).

  #clone(v: any): any {
    return cloneJsonData(v);
  }

  #get(p: string): unknown {
    return readJsonPath(this.data, p);
  }

  #set(p: string, v: unknown): JsonMutationResult {
    return writeJsonPath(this.data, p, v);
  }

  #delete(p: string): JsonMutationResult {
    if (!p) {
      return createMutationResult({
        path: '',
        kind: 'delete',
        previous: this.data,
        existed: true,
        deleted: [''],
        branchReplaced: true,
        affectedPaths: [''],
      });
    }
    return deleteJsonPath(this.data, p);
  }

  #proxyParent(p: string): { node: any; key: string | null } {
    const plan = createJsonPathPlan(p);
    if (plan.key == null) return { node: this.store as any, key: null };
    let node: any = this.store as any;
    for (const segment of plan.parentSegments) {
      if (node == null) return { node: undefined, key: plan.key };
      node = node[segment];
    }
    return { node, key: plan.key };
  }

  // Use proxy assignment to wake signals + run traps (emit/sync) after bulk ops.
  // Now delegates to SST resolveParentAndKey (micro-walk unification).
  #assign(p: string, v: unknown): void {
    if (!p) return;
    const { node, key: last } = this.#proxyParent(p);
    if (node != null && last != null) node[last] = v;
  }

  #isBranchValue(value: unknown): boolean {
    return value !== null && typeof value === 'object';
  }

  #wakeMutation(result: JsonMutationResult): void {
    const wake = (this as any).__wakeMutationResult as ((mutation: JsonMutationResult) => void) | undefined;
    wake?.(result);
  }

  #wakeMutations(results: JsonMutationResult[]): void {
    const wakeMany = (this as any).__wakeMutationResults as ((mutations: JsonMutationResult[]) => void) | undefined;
    if (wakeMany) {
      wakeMany(results);
      return;
    }
    for (const result of results) this.#wakeMutation(result);
  }

  // Root mutation special-case (key-diff + per-key delete) — required subtle contract.
  #commitRoot(next: any): void {
    const curr: any = this.data ?? {};
    const n = next ?? {};
    const keys = new Set<string>([...Object.keys(curr), ...Object.keys(n)]);
    batch(() => {
      const mutations: JsonMutationResult[] = [];
      for (const k of keys) {
        const existed = Object.prototype.hasOwnProperty.call(curr, k);
        const previous = curr[k];
        if (!(k in n)) {
          if (existed) delete curr[k];
          mutations.push(createMutationResult({
            path: k,
            kind: 'delete',
            previous,
            existed,
            deleted: existed ? [k] : [],
            branchReplaced: false,
            affectedPaths: [k],
          }));
          this.emitDevAction({ type: 'DELETE', payload: { path: k } });
        } else {
          curr[k] = n[k];
          mutations.push(createMutationResult({
            path: k,
            kind: 'set',
            previous,
            next: n[k],
            existed,
            changed: [k],
            inserted: existed ? [] : [k],
            branchReplaced: this.#isBranchValue(previous) || this.#isBranchValue(n[k]),
            affectedPaths: [k],
          }));
          this.emitDevAction({ type: 'SET_VALUE', payload: { path: k, value: n[k] } });
        }
      }
      this.#wakeMutations(mutations);
    });
  }

  #commit(p: string, v: unknown): void {
    if (!p) { this.#commitRoot(v); return; }
    this.#assign(p, v);
  }

  // Fine-grained mutate commit (opt-in): write the new branch value into data, then
  // wake only the changed leaves + the branch signal itself — NOT the whole subtree.
  // Branch subscribers ($liveQuery) still wake via the ancestor walk in wakeFromMutation.
  #commitPrecise(p: string, v: unknown, relPaths: readonly string[]): void {
    this.#set(p, v); // data write only; no proxy branch-wide wake
    const results: JsonMutationResult[] = [];
    for (const rel of relPaths) {
      const leaf = `${p}.${rel}`;
      results.push(createMutationResult({ path: leaf, kind: 'set', changed: [leaf], affectedPaths: [leaf], branchReplaced: false }));
    }
    // Wake the branch signal so whole-array consumers refresh, without syncDescendants.
    results.push(createMutationResult({ path: p, kind: 'set', changed: [p], affectedPaths: [p], branchReplaced: false }));
    this.#wakeMutations(results);
    this.emitDevAction({ type: 'SET_VALUE', payload: { path: p, value: v } });
  }

  // === StoreMutator (exact contract wired to proxy) ===

  read(path: string): unknown { return this.#get(path ?? ''); }
  write(path: string, value: unknown): JsonMutationResult { return this.#set(path ?? '', value); }
  batch<T>(fn: () => T): T { return batch(fn); }
  delete(path: string): JsonMutationResult { return this.#delete(path ?? ''); }
  prefetch(pathPrefix: string): void { this.#get(pathPrefix ?? ''); /* warms for cursor/prefetch contract */ }
  emitDevAction(action: StoreDevToolsAction): void {
    if (!this.devActive) return;
    queueMicrotask(() => emitDev({ ...action, storeName: this.name }));
  }
  cleanupPath(path: string): void {
    this.emitDevAction({ type: 'CLEANUP', payload: { path, cleanedPaths: [path], cleanedCount: 1 } });
  }

  // === Extra surface (called by proxy traps on sub/root + public API) ===

  readStore(path = ''): unknown { return this.read(path); }
  setValue(path: string, value: unknown): void { this.#assign(path ?? '', value); }
  deleteValue(path: string): void {
    if (!path) return;
    const { node, key: last } = this.#proxyParent(path);
    if (node && last != null) delete node[last];
  }

  // Uses shared constants from array layer (single source of truth — zero duplication with executeArrayOperation)
  private isArrayQueryMethod(m: string): boolean {
    return ARRAY_QUERY_METHODS.has(m);
  }
  private isArrayMutationMethod(m: string): boolean {
    return ARRAY_MUTATION_METHODS.has(m);
  }

  // Direct array method dispatch from proxy (store.users.push etc.)
  arrayOp(path: string, method: string, args: unknown[] = []): unknown {
    const cur = this.#get(path);
    if (!Array.isArray(cur)) return undefined;

    // Query-only fast path (no mutation, no COW)
    if (this.isArrayQueryMethod(method)) {
      if (method === 'length') return cur.length;
      return (cur as any)[method](...(args as any));
    }

    // opinia3 #2: precise tail-only mutation result for push/pop. These never reindex existing
    // elements, so we wake only the array signal + the inserted/removed tail index — NOT every
    // observed element signal (which the conservative branch-replace path below would). All other
    // methods (splice/shift/unshift/sort/reverse/…) reindex and keep the proven path unchanged.
    const precise = this.#tryPreciseTailArrayOp(path, cur, method, args);
    if (precise) return precise.result;

    const arr = [...cur];
    const r = applyArrayMutation(arr, method, args);
    if (r !== undefined || this.isArrayMutationMethod(method)) {
      this.batch(() => this.#assign(path, arr));
    }
    return r;
  }

  // Returns a boxed result when handled (push/pop), or null to fall through to the generic path.
  #tryPreciseTailArrayOp(path: string, cur: unknown[], method: string, args: unknown[]): { result: unknown } | null {
    // Note: the proxy's array-method handler already emits the ARRAY_DISPATCH dev event before
    // calling arrayOp, so we must NOT emit it again here (would double-log push/pop). (self-review)
    if (method === 'push') {
      // Native push() with no args returns length and changes nothing — skip the copy + wake. (self-review)
      if (args.length === 0) return { result: cur.length };
      const startIndex = cur.length;
      const next = cur.slice();
      args.length === 1 ? next.push(args[0]) : next.push(...args);
      this.#set(path, next);
      this.batch(() => {
        const results: JsonMutationResult[] = [
          createMutationResult({ path, kind: 'set', previous: cur, next, existed: true, changed: [path], branchReplaced: false, affectedPaths: [path] }),
        ];
        for (let i = 0; i < args.length; i++) {
          const ip = `${path}.${startIndex + i}`;
          results.push(createMutationResult({ path: ip, kind: 'set', next: args[i], existed: false, inserted: [ip], branchReplaced: this.#isBranchValue(args[i]), affectedPaths: [ip] }));
        }
        this.#wakeMutations(results);
      });
      return { result: next.length };
    }
    if (method === 'pop') {
      if (cur.length === 0) return { result: undefined };
      const lastIndex = cur.length - 1;
      const popped = cur[lastIndex];
      const next = cur.slice(0, lastIndex);
      this.#set(path, next);
      const lp = `${path}.${lastIndex}`;
      this.batch(() => {
        this.#wakeMutations([
          createMutationResult({ path, kind: 'set', previous: cur, next, existed: true, changed: [path], branchReplaced: false, affectedPaths: [path] }),
          createMutationResult({ path: lp, kind: 'delete', previous: popped, existed: true, deleted: [lp], branchReplaced: this.#isBranchValue(popped), affectedPaths: [lp] }),
        ]);
      });
      return { result: popped };
    }
    return null;
  }

  // query dispatch from proxy (array query surface parity)
  query(path: string, val: unknown, method: string, ...args: unknown[]): unknown {
    const cur = this.#get(path);
    if (!Array.isArray(cur)) return method === 'length' ? 0 : undefined;
    if (method === 'length') return cur.length;
    return (cur as any)[method]?.(val, ...args);
  }

  // === Bridge access (extracted — removes repeated globalThis lookup + warn-once logic)
  private getJsondbBridge(): any {
    return this.opts.jsondbBridge || (globalThis as any).__SOLID_PIPELINE_BRIDGE || (globalThis as any).solidJsondbBridge;
  }

  private warnOnceBridgeMissing(): void {
    if (!(globalThis as any).__solidBridgeWarned) {
      (globalThis as any).__solidBridgeWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[SolidStore] mutate/pipe dispatched to missing bridge — register solid-pipeline-bridge.ts');
    }
  }

  // Jsondb bridge dispatch (mutate/pipe) — exact future contract, no dupe of pipeline
  mutate(path: string, ...ops: any[]): unknown {
    const p = path ?? '';
    const current = this.readStore(p);
    if (current === undefined) return undefined;

    this.emitDevAction({ type: 'MUTATE', payload: { path: p, opCount: ops.length } });

    let result: unknown = current;
    const hasMutationOps = ops.some((op) => !!op?.__isMutation);
    this.batch(() => {
      // Contract: applyPipelineMutation(ops, currentValue, { isRoot, path })
      // Bridge owns COW + stats; we only do the commit here.
      const bridge = this.getJsondbBridge();
      let bridgeApplied = false;
      if (bridge?.applyPipelineMutation) {
        // Opt-in fine-grained wake for sub-path branches (flat value-action shape only).
        if (this.opts.preciseMutationWake && p && bridge.applyPipelineMutationDetailed) {
          const detailed = bridge.applyPipelineMutationDetailed(ops, current, { isRoot: false, path: p, bridgeErrorMode: this.opts.bridgeErrorMode });
          result = detailed.value;
          if (detailed.mutations && detailed.mutations.length > 0) {
            this.#commitPrecise(p, result, detailed.mutations);
            return;
          }
          // Not precise-eligible (or zero matches): fall back to the standard branch commit.
          if (hasMutationOps || result !== current) this.#commit(p, result);
          return;
        }
        result = bridge.applyPipelineMutation(ops, current, { isRoot: !p, path: p, bridgeErrorMode: this.opts.bridgeErrorMode });
        bridgeApplied = true;
      } else {
        this.warnOnceBridgeMissing();
        result = current;
      }
      if (bridgeApplied && (hasMutationOps || result !== current)) this.#commit(p, result);
    });
    return result;
  }

  pipe(path: string, ...ops: any[]): any {
    const p = path ?? '';
    const current = this.readStore(p);
    const bridge = this.getJsondbBridge();
    if (bridge?.createPipeline) {
      return bridge.createPipeline(current, ops, { path: p });
    }
    // Minimal builder fallback (queries only; real ops in bridge)
    return {
      all: () => (Array.isArray(current) ? [...current] : current),
      first: () => (Array.isArray(current) ? current[0] : current),
      count: () => (Array.isArray(current) ? current.length : current != null ? 1 : 0),
    };
  }

  // === opinia5: jsondb-powered reads — same where(...) DSL as mutate, for read + subscribe ===

  /** One-shot snapshot query: runs the jsondb operators at `path`, returns matched values. */
  $query(path: string, ...ops: any[]): unknown[] {
    return this.#runJsondbQuery(path ?? '', ops, 'all') as unknown[];
  }

  /** One-shot snapshot query returning the first match (or null). */
  $queryOne(path: string, ...ops: any[]): unknown {
    return this.#runJsondbQuery(path ?? '', ops, 'first');
  }

  /** Reactive query: recomputes when the queried branch changes. Callable + subscribable. */
  $liveQuery(path: string, ...ops: any[]): SolidLiveQuery<unknown[]> {
    return this.#createLiveQuery(path ?? '', ops, 'all') as SolidLiveQuery<unknown[]>;
  }

  /** Reactive single-match query (first match, reactive). */
  $liveQueryOne(path: string, ...ops: any[]): SolidLiveQuery<unknown> {
    return this.#createLiveQuery(path ?? '', ops, 'first');
  }

  #runJsondbQuery(path: string, ops: any[], mode: 'all' | 'first'): unknown {
    const snapshot = this.readStore(path);
    const bridge = this.getJsondbBridge();
    if (bridge?.createPipeline && ops.length > 0) {
      const wrapper = bridge.createPipeline(snapshot, ops, { path });
      if (mode === 'first') {
        const node: any = wrapper.execute('first');
        return node && typeof node === 'object' && 'data' in node ? node.data : (node ?? null);
      }
      const nodes = wrapper.execute('all');
      return Array.isArray(nodes)
        ? nodes.map((n: any) => (n && typeof n === 'object' && 'data' in n ? n.data : n))
        : [];
    }
    // No operators (or no bridge): return the raw branch (array as-is / first element / value).
    if (mode === 'first') return Array.isArray(snapshot) ? (snapshot[0] ?? null) : (snapshot ?? null);
    if (Array.isArray(snapshot)) return [...snapshot];
    return snapshot == null ? [] : [snapshot];
  }

  // Read the Solid signal for `path` so the enclosing memo depends on it (live recompute source).
  #trackBranch(path: string): void {
    const node: any = this.#resolveProxyNode(path);
    if (typeof node === 'function') node();
  }

  #resolveProxyNode(path: string): unknown {
    if (!path) return this.store;
    const plan = createJsonPathPlan(path);
    let node: any = this.store;
    for (const seg of plan.segments) {
      if (node == null) return undefined;
      node = node[seg];
    }
    return node;
  }

  #createLiveQuery(path: string, ops: any[], mode: 'all' | 'first'): SolidLiveQuery<unknown> {
    const p = path ?? '';
    const addBranch = (this as any).__addBranchSub as ((path: string) => void) | undefined;
    const removeBranch = (this as any).__removeBranchSub as ((path: string) => void) | undefined;
    addBranch?.(p); // creation ref — keeps the accessor reactive until the query is disposed
    let creationReleased = false;
    const releaseCreation = () => {
      if (creationReleased) return;
      creationReleased = true;
      removeBranch?.(p);
    };
    const acc = createMemo(() => {
      this.#trackBranch(p);
      return this.#runJsondbQuery(p, ops, mode);
    });
    const live = (() => acc()) as SolidLiveQuery<unknown>;
    live.subscribe = (cb: (value: unknown) => void, options?: ProjectionObservableOptions<unknown>) => {
      addBranch?.(p); // subscription ref (ref-counted with the creation ref + other subs)
      const sub = createProjectionObservable(acc, options).subscribe(cb);
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        sub.unsubscribe();
        removeBranch?.(p);  // release this subscription's ref
        releaseCreation();  // and the creation ref, so inline `$liveQuery(...).subscribe()` fully cleans up
      };
      return { unsubscribe: close, dispose: close };
    };
    live.dispose = releaseCreation;
    return live;
  }

  // Fluent array entry — clean top-level wiring to dedicated layer (per PLAN v2 + Critic)
  array(path: string, ...args: any[]): any {
    const p = path || (args[0] ?? '');
    return createArrayChain(p, {
      read: (pp: string) => this.read(pp),
      commit: (pp: string, val: unknown) => this.#assign(pp, val),
      batch: (fn: () => void) => this.batch(fn),
    });
  }

  // select / computedOf — computedOf is deliberately 3 lines (PLAN rule)
  select<TOut>(project: (state: SolidStoreProxy<T>) => TOut, options?: ProjectionObservableOptions<TOut>) {
    const acc = this.computedOf(project);
    return createProjectionObservable(acc, options);
  }

  computedOf<TOut>(project: (state: SolidStoreProxy<T>) => TOut): Accessor<TOut> {
    // Automatic fine-grained tracking: project runs against callable proxy.
    return createMemo(() => project(this.store));
  }

  // Devtools + lifecycle (parity)
  enableDevTools(storeName?: string, _showVisualizer = true): void {
    this.devActive = true;
    if (storeName) this.name = storeName;
    this.emitDevAction({ type: 'DEVTOOLS_ENABLED', payload: { storeName: this.name } });
  }

  destroy(): void {
    this.batch(() => {
      Object.keys(this.data ?? {}).forEach((k) => this.cleanupPath(k));
    });
    registry.delete(this.name);
    this.devActive = false;
    this.emitDevAction({ type: 'STORE_DESTROYED', payload: { storeName: this.name } });
  }

  returnStore(): SolidStoreProxy<T> { return this.store; }

  // Internal helpers exposed for bridge/advanced (parity with original createService surface)
  get _internalData() { return this.data; }

  /**
   * Runtime control of wake-up granularity.
   *
   * store.wakeUp('grained')     → only the exact changed path is dirtied (default, recommended)
   * store.wakeUp('container')   → also dirty parents on the path (more "container" behavior)
   * store.wakeUp('a.b.c', 'leaf') → Angular-compatible targeted branch wake for one path
   */
  setWakeMode(mode: SolidWakeMode): void {
    this.wakeUp(mode);
  }

  wakePath(path: string, mode: SolidWakeMode = 'grained'): void {
    this.wakeUp(path, mode);
  }

  wakeUp(mode: SolidWakeMode): void;
  wakeUp(path: string, mode?: SolidWakeMode): void;
  wakeUp(pathOrMode: string, mode?: SolidWakeMode): void {
    if (mode === undefined && GLOBAL_WAKE_MODES.has(pathOrMode as SolidWakeMode)) {
      const normalized = pathOrMode === 'fine' || pathOrMode === 'grained' || pathOrMode === 'exact' ? false : true;
      (this as any)._wakeParentsOnChange = normalized;
      return;
    }
    const wakePath = (this as any).__wakeSignalPath as ((path: string, mode?: SolidWakeMode) => void) | undefined;
    wakePath?.(pathOrMode, mode ?? 'grained');
  }
}

// --- Public factories (full parity surface) ---

export function createSolidStore<T extends Record<string, unknown>>(
  initial: T,
  name = 'default',
  options?: SolidStoreOptions
): SolidStore<T> {
  const prev = registry.get(name);
  if (prev) prev.destroy();
  return new SolidStore<T>(initial, name, options);
}

export function useSolidStore<T extends Record<string, unknown> = any>(name = 'default'): SolidStore<T> {
  const s = registry.get(name);
  if (!s) throw new Error(`[SolidStore] useSolidStore('${name}'): store not found. Create first.`);
  return s as SolidStore<T>;
}

// Headless / vanilla friendly (no owner required for creation + plain reads/writes/mutate).
// For createMemo/createEffect over .store use createRoot in non-component usage.

export default SolidStore;

// Re-exports for wiring / testing
export type { StoreMutator, SolidProxyOptions, SolidWakeMode } from '../proxy/solid-proxy';
export { createSolidProxy } from '../proxy/solid-proxy';
export type { SolidStoreProxy, StoreArray, StoreLeaf } from './proxy-types';
