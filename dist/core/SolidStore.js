/**
 * SolidStore.ts — single central orchestrator (CreateStore + SignalStore parity).
 * Wires createSolidProxy + narrow StoreMutator. Real in-memory root.
 * Jsnq bridge dispatch for mutate/pipe (future solid-pipeline-bridge).
 * Full public surface, headless/vanilla, batch(), zero logic dupe (proxy/bridge own theirs).
 * Minimal and contract-driven: proxy identity, cursor prefetch, root key-diff, devtools event shapes, GC cleanup.
 */
import { batch, createMemo } from 'solid-js';
import { createSolidProxy, } from '../proxy/solid-proxy.js';
import { createArrayChain, ARRAY_QUERY_METHODS, ARRAY_MUTATION_METHODS, applyArrayMutation } from '../array/solid-array.js'; // clean top-level import (premium wiring) + shared method sets + pure dispatch (max dispatch style, no switches)
import { cloneJsonData, createJsonPathPlan, createMutationResult, deleteJsonPath, readJsonPath, writeJsonPath, writeJsonPathValue, } from '@synestiqx/jsnq/data-engine';
import { createProjectionObservable } from './rx-interop.js';
import { EMPTY_DEV_STREAM, } from './devtools-contract.js';
const GLOBAL_WAKE_MODES = new Set(['grained', 'fine', 'exact', 'container', 'parents', 'leaf', 'branch']);
// Global dev bus (parity with original DevToolsActionSubject / emit patterns)
const devListeners = new Set();
function emitDev(ev) {
    for (const fn of devListeners) {
        try {
            fn(ev);
        }
        catch { /* isolated */ }
    }
}
export function onSolidDevAction(fn) {
    devListeners.add(fn);
    return () => devListeners.delete(fn);
}
// Named store registry (useSolidStore + createStore(name) parity with SignalStore)
const registry = new Map();
const registryWaiters = new Map();
function resolveRegistryWaiters(name, store) {
    const waiters = registryWaiters.get(name);
    if (!waiters)
        return;
    registryWaiters.delete(name);
    for (const waiter of waiters) {
        waiter.cleanup();
        waiter.resolve(store);
    }
}
// --- Orchestrator ---
export class SolidStore {
    store; // the callable proxied reactive root (full surface via traps)
    data;
    name;
    registryName;
    devActive = false;
    opts;
    // Typed reactivity surface installed by createSolidProxy (replaces `(this as any).__wakeX`).
    reactivity;
    // Typed wake-parents flag (read by the proxy manager's shouldWakeParents getter).
    _wakeParentsOnChange = false;
    devService;
    destroyed = false;
    /** Action stream (subscribe for SET_VALUE/MUTATE/DELETE/PROXY_METRICS events). */
    get devAction$() { return this.devService?.action$ ?? EMPTY_DEV_STREAM; }
    /** Read/history stream (excludes PROXY_METRICS, parity with Angular readAction$). */
    get devReadAction$() { return this.devService?.readAction$ ?? EMPTY_DEV_STREAM; }
    /** Typed binding called by createSolidProxy so the store can wake proxy-owned signals. */
    bindReactivity(api) { this.reactivity = api; }
    constructor(initial, name = 'default', opts = {}) {
        this.name = name;
        this.registryName = name;
        this.opts = opts;
        this.devService = opts.devtools;
        this.data = this.#clone(initial ?? {});
        const mutator = this;
        this._wakeParentsOnChange = opts.wakeParentsOnChange ?? false;
        const pOpts = {
            strictInvalidPath: opts.strict?.invalidPath,
            strictDeleteUndefined: opts.strict?.deleteUndefined,
            ...(opts._onSignalUpdate ? { _onSignalUpdate: opts._onSignalUpdate } : {}),
        };
        this.store = createSolidProxy(mutator, pOpts);
        registry.set(name, this);
        resolveRegistryWaiters(name, this);
    }
    // --- Path orchestration (delegates to unified internal primitives) ---
    // Eliminates previous inline duplication. Root (empty path) semantics preserved.
    // All core files (bridge, SolidStore, PathUtils, proxy) delegate to src/internal/path.ts
    // as the single source of truth (SST) for simple path logic.
    #clone(v) {
        return cloneJsonData(v);
    }
    #get(p) {
        return readJsonPath(this.data, p);
    }
    #set(p, v) {
        return writeJsonPath(this.data, p, v);
    }
    #setValueOnly(p, v) {
        writeJsonPathValue(this.data, p, v);
    }
    #delete(p) {
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
    // Direct raw-data write + explicit signal wake + devtools emit. Replaces the previous
    // proxy-walk (`#proxyParent` + `node[last] = v`) which read/created proxy nodes during
    // commits — wasteful and a side-effect hazard. Mirrors Angular's `mutateStoreNormalized`
    // (#set + #wakeMutation) and the existing #commitPrecise pattern. `writeJsonPath` returns
    // the JsonMutationResult so the wake is identical to what the proxy set trap would do.
    #assign(p, v) {
        if (!p)
            return;
        const result = this.#set(p, v);
        this.#wakeMutation(result);
        this.emitDevAction({ type: 'SET_VALUE', payload: { path: p, value: v } });
    }
    #isBranchValue(value) {
        return value !== null && typeof value === 'object';
    }
    #wakeMutation(result) {
        this.reactivity?.wakeMutation(result);
    }
    #wakeMutations(results) {
        if (this.reactivity) {
            this.reactivity.wakeMutations(results);
            return;
        }
        for (const result of results)
            this.#wakeMutation(result);
    }
    // Root mutation special-case (key-diff + per-key delete) — required subtle contract.
    #commitRoot(next) {
        const curr = this.data ?? {};
        const n = next ?? {};
        const keys = new Set([...Object.keys(curr), ...Object.keys(n)]);
        batch(() => {
            const mutations = [];
            for (const k of keys) {
                const existed = Object.prototype.hasOwnProperty.call(curr, k);
                const previous = curr[k];
                if (!(k in n)) {
                    if (existed)
                        delete curr[k];
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
                }
                else {
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
    #commit(p, v) {
        if (!p) {
            this.#commitRoot(v);
            return;
        }
        this.#assign(p, v);
    }
    // Fine-grained mutate commit (opt-in): write the new branch value into data, then
    // wake only the changed leaves + the branch signal itself — NOT the whole subtree.
    // Branch subscribers ($liveQuery) still wake via the ancestor walk in wakeFromMutation.
    #commitPrecise(p, v, relPaths) {
        this.#setValueOnly(p, v); // data write only; no proxy branch-wide wake
        const results = [];
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
    read(path) { return this.#get(path ?? ''); }
    write(path, value) { return this.#set(path ?? '', value); }
    batch(fn) { return batch(fn); }
    delete(path) { return this.#delete(path ?? ''); }
    prefetch(pathPrefix) { this.#get(pathPrefix ?? ''); /* warms for cursor/prefetch contract */ }
    emitDevAction(action) {
        if (!this.devActive)
            return;
        const event = { ...action, storeName: this.name };
        // Per-store typed stream (parity with Angular DevService.action$ / readAction$).
        this.devService?.emitAction(event);
        if (action.type !== 'PROXY_METRICS')
            this.devService?.emitRead(event);
        // Legacy global bus kept for back-compat (onSolidDevAction public API).
        queueMicrotask(() => emitDev(event));
    }
    cleanupPath(path) {
        this.emitDevAction({ type: 'CLEANUP', payload: { path, cleanedPaths: [path], cleanedCount: 1 } });
    }
    // === Extra surface (called by proxy traps on sub/root + public API) ===
    readStore(path = '') { return this.read(path); }
    setValue(path, value) { this.#assign(path ?? '', value); }
    deleteValue(path) {
        if (!path)
            return;
        const result = this.#delete(path);
        this.#wakeMutation(result);
        this.emitDevAction({ type: 'DELETE', payload: { path } });
    }
    // Uses shared constants from array layer (single source of truth — zero duplication with executeArrayOperation)
    isArrayQueryMethod(m) {
        return ARRAY_QUERY_METHODS.has(m);
    }
    isArrayMutationMethod(m) {
        return ARRAY_MUTATION_METHODS.has(m);
    }
    // Direct array method dispatch from proxy (store.users.push etc.)
    arrayOp(path, method, args = [], current) {
        const cur = Array.isArray(current) ? current : this.#get(path);
        if (!Array.isArray(cur))
            return undefined;
        // Query-only fast path (no mutation, no COW)
        if (this.isArrayQueryMethod(method)) {
            if (method === 'length')
                return cur.length;
            return cur[method](...args);
        }
        // opinia3 #2: precise tail-only mutation result for push/pop. These never reindex existing
        // elements, so we wake only the array signal + the inserted/removed tail index — NOT every
        // observed element signal (which the conservative branch-replace path below would). All other
        // methods (splice/shift/unshift/sort/reverse/…) reindex and keep the proven path unchanged.
        const precise = this.#tryPreciseTailArrayOp(path, cur, method, args);
        if (precise)
            return precise.result;
        // opinia6 (unify): precise splice. When preciseMutationWake is on, splice(start>0) wakes only
        // element signals at index >= start (skips the untouched [0,start) prefix), mirroring Angular's
        // computeSpliceInvalidationStart at the signal level. push/pop are already precise above;
        // shift/unshift/reverse/sort touch index 0 (no prefix to skip) and keep the proven branch path.
        if (this.opts.preciseMutationWake && method === 'splice') {
            const spliced = this.#tryPreciseSplice(path, cur, args);
            if (spliced)
                return spliced.result;
        }
        const arr = [...cur];
        const r = applyArrayMutation(arr, method, args);
        if (r !== undefined || this.isArrayMutationMethod(method)) {
            this.batch(() => this.#assign(path, arr));
        }
        return r;
    }
    // Returns a boxed result when handled (push/pop), or null to fall through to the generic path.
    #tryPreciseTailArrayOp(path, cur, method, args) {
        // Note: the proxy's array-method handler already emits the ARRAY_DISPATCH dev event before
        // calling arrayOp, so we must NOT emit it again here (would double-log push/pop). (self-review)
        if (method === 'push') {
            // Native push() with no args returns length and changes nothing.
            if (args.length === 0)
                return { result: cur.length };
            const startIndex = cur.length;
            const nextLength = args.length === 1 ? cur.push(args[0]) : cur.push(...args);
            this.batch(() => {
                for (let i = 0; i < args.length; i++) {
                    this.reactivity?.wakeArrayTail(path, startIndex + i, this.#isBranchValue(args[i]));
                }
            });
            return { result: nextLength };
        }
        if (method === 'pop') {
            if (cur.length === 0)
                return { result: undefined };
            const lastIndex = cur.length - 1;
            const popped = cur.pop();
            this.batch(() => {
                this.reactivity?.wakeArrayTail(path, lastIndex, this.#isBranchValue(popped));
            });
            return { result: popped };
        }
        return null;
    }
    // Precise splice (opt-in): COW + data write, then wake only signals at index >= start.
    // Returns boxed removed[] when handled, or null to fall through to the proven branch path
    // (container mode, or start<=0 where the whole array shifts and there is no prefix to skip).
    #tryPreciseSplice(path, cur, args) {
        // Container mode wakes ancestors too — keep the proven full-branch path for byte parity.
        if (this._wakeParentsOnChange)
            return null;
        const len = cur.length;
        const rawStart = Number(args[0] ?? 0);
        const start = rawStart < 0 ? Math.max(len + rawStart, 0) : Math.min(rawStart, len);
        if (start <= 0)
            return null; // no untouched prefix to skip
        const next = [...cur];
        const removed = applyArrayMutation(next, 'splice', args);
        this.#setValueOnly(path, next);
        this.batch(() => {
            this.reactivity?.wakeArraySplice(path, start);
        });
        return { result: removed };
    }
    // query dispatch from proxy (array query surface parity)
    query(path, val, method, ...args) {
        const cur = this.#get(path);
        if (!Array.isArray(cur))
            return method === 'length' ? 0 : undefined;
        if (method === 'length')
            return cur.length;
        return cur[method]?.(val, ...args);
    }
    // === Bridge access (extracted — removes repeated globalThis lookup + warn-once logic)
    getJsnqBridge() {
        return this.opts.jsnqBridge || globalThis.__SOLID_PIPELINE_BRIDGE || globalThis.solidJsnqBridge;
    }
    requireJsnqBridge(operation) {
        const bridge = this.getJsnqBridge();
        if (bridge)
            return bridge;
        throw new Error(`[SolidStore] ${operation} requires the optional JSNQ bridge. ` +
            `Import 'solidstore/jsnq' once or pass { jsnqBridge } to createSolidStore().`);
    }
    // Jsnq bridge dispatch (mutate/pipe) — exact future contract, no dupe of pipeline
    mutate(path, ...ops) {
        const p = path ?? '';
        const current = this.readStore(p);
        if (current === undefined)
            return undefined;
        this.emitDevAction({ type: 'MUTATE', payload: { path: p, opCount: ops.length } });
        let result = current;
        const hasMutationOps = ops.some((op) => !!op?.__isMutation);
        this.batch(() => {
            // Contract: applyPipelineMutation(ops, currentValue, { isRoot, path })
            // Bridge owns COW + stats; we only do the commit here.
            const bridge = ops.length > 0 ? this.requireJsnqBridge('mutate()') : this.getJsnqBridge();
            let bridgeApplied = false;
            if (bridge?.applyPipelineMutation) {
                // Opt-in fine-grained wake for sub-path branches (flat value-action shape only).
                if (this.opts.preciseMutationWake && p && bridge.applyPipelineMutationDetailed) {
                    const detailed = bridge.applyPipelineMutationDetailed(ops, current, {
                        isRoot: false,
                        path: p,
                        bridgeErrorMode: this.opts.bridgeErrorMode,
                        trackOperations: this.devActive,
                    });
                    result = detailed.value;
                    if (detailed.mutations && detailed.mutations.length > 0) {
                        this.#commitPrecise(p, result, detailed.mutations);
                        return;
                    }
                    // Not precise-eligible (or zero matches): fall back to the standard branch commit.
                    if (hasMutationOps || result !== current)
                        this.#commit(p, result);
                    return;
                }
                result = bridge.applyPipelineMutation(ops, current, {
                    isRoot: !p,
                    path: p,
                    bridgeErrorMode: this.opts.bridgeErrorMode,
                    trackOperations: this.devActive,
                });
                bridgeApplied = true;
            }
            if (bridgeApplied && (hasMutationOps || result !== current))
                this.#commit(p, result);
        });
        return result;
    }
    pipe(path, ...ops) {
        const p = path ?? '';
        const current = this.readStore(p);
        const bridge = this.getJsnqBridge();
        if (bridge?.createPipeline) {
            return bridge.createPipeline(current, ops, { path: p, trackOperations: this.devActive });
        }
        if (ops.length > 0)
            this.requireJsnqBridge('pipe()');
        // No-op builder is useful for reading an unfiltered branch without JSNQ.
        return {
            all: () => (Array.isArray(current) ? [...current] : current),
            first: () => (Array.isArray(current) ? current[0] : current),
            count: () => (Array.isArray(current) ? current.length : current != null ? 1 : 0),
        };
    }
    // === opinia5: jsnq-powered reads — same where(...) DSL as mutate, for read + subscribe ===
    /** One-shot snapshot query: runs the jsnq operators at `path`, returns matched values. */
    $query(path, ...ops) {
        return this.#runJsnqQuery(path ?? '', ops, 'all');
    }
    /** One-shot snapshot query returning the first match (or null). */
    $queryOne(path, ...ops) {
        return this.#runJsnqQuery(path ?? '', ops, 'first');
    }
    /** Reactive query: recomputes when the queried branch changes. Callable + subscribable. */
    $liveQuery(path, ...ops) {
        return this.#createLiveQuery(path ?? '', ops, 'all');
    }
    /** Reactive single-match query (first match, reactive). */
    $liveQueryOne(path, ...ops) {
        return this.#createLiveQuery(path ?? '', ops, 'first');
    }
    #runJsnqQuery(path, ops, mode) {
        const snapshot = this.readStore(path);
        const bridge = this.getJsnqBridge();
        if (bridge?.createPipeline && ops.length > 0) {
            const wrapper = bridge.createPipeline(snapshot, ops, { path, trackOperations: this.devActive });
            if (mode === 'first') {
                return wrapper.execute('first') ?? null;
            }
            const nodes = wrapper.execute('all');
            return Array.isArray(nodes)
                ? nodes.map((n) => (n && typeof n === 'object' && 'data' in n ? n.data : n))
                : [];
        }
        if (ops.length > 0)
            this.requireJsnqBridge(mode === 'first' ? '$queryOne()' : '$query()');
        // No operators (or no bridge): return the raw branch (array as-is / first element / value).
        if (mode === 'first')
            return Array.isArray(snapshot) ? (snapshot[0] ?? null) : (snapshot ?? null);
        if (Array.isArray(snapshot))
            return [...snapshot];
        return snapshot == null ? [] : [snapshot];
    }
    // Read the Solid signal for `path` so the enclosing memo depends on it (live recompute source).
    #trackBranch(path) {
        const node = this.#resolveProxyNode(path);
        if (typeof node === 'function')
            node();
    }
    #resolveProxyNode(path) {
        if (!path)
            return this.store;
        const plan = createJsonPathPlan(path);
        let node = this.store;
        for (const seg of plan.segments) {
            if (node == null)
                return undefined;
            node = node[seg];
        }
        return node;
    }
    #createLiveQuery(path, ops, mode) {
        const p = path ?? '';
        const addBranch = (p) => this.reactivity?.addBranchSub(p);
        const removeBranch = (p) => this.reactivity?.removeBranchSub(p);
        addBranch(p); // creation ref — keeps the accessor reactive until the query is disposed
        let creationReleased = false;
        const releaseCreation = () => {
            if (creationReleased)
                return;
            creationReleased = true;
            removeBranch(p);
        };
        const acc = createMemo(() => {
            this.#trackBranch(p);
            return this.#runJsnqQuery(p, ops, mode);
        });
        const live = (() => acc());
        live.subscribe = (cb, options) => {
            addBranch?.(p); // subscription ref (ref-counted with the creation ref + other subs)
            const sub = createProjectionObservable(acc, options).subscribe(cb);
            let closed = false;
            const close = () => {
                if (closed)
                    return;
                closed = true;
                sub.unsubscribe();
                removeBranch?.(p); // release this subscription's ref
                releaseCreation(); // and the creation ref, so inline `$liveQuery(...).subscribe()` fully cleans up
            };
            return { unsubscribe: close, dispose: close };
        };
        live.dispose = releaseCreation;
        return live;
    }
    // Fluent array entry — top-level wiring to the dedicated array layer.
    array(path, ...args) {
        const p = path || (args[0] ?? '');
        return createArrayChain(p, {
            read: (pp) => this.read(pp),
            commit: (pp, val) => this.#assign(pp, val),
            batch: (fn) => this.batch(fn),
        });
    }
    // select / computedOf — computedOf is deliberately 3 lines (PLAN rule)
    select(project, options) {
        const acc = this.computedOf(project);
        return createProjectionObservable(acc, options);
    }
    computedOf(project) {
        // Automatic fine-grained tracking: project runs against callable proxy.
        return createMemo(() => project(this.store));
    }
    // Devtools + lifecycle (parity)
    enableDevTools(storeName, _showVisualizer = true) {
        this.devActive = true;
        if (storeName)
            this.name = storeName;
        this.emitDevAction({ type: 'DEVTOOLS_ENABLED', payload: { storeName: this.name } });
    }
    attachDevtools(devtools) {
        if (this.devService === devtools)
            return;
        this.devService?.destroy();
        this.devService = devtools;
    }
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.batch(() => {
            Object.keys(this.data ?? {}).forEach((k) => this.cleanupPath(k));
        });
        if (registry.get(this.registryName) === this)
            registry.delete(this.registryName);
        this.emitDevAction({ type: 'STORE_DESTROYED', payload: { storeName: this.name } });
        this.devActive = false;
        this.reactivity?.destroy();
        this.reactivity = undefined;
        this.devService?.destroy();
        this.devService = undefined;
    }
    /**
     * Emit a PROXY_METRICS snapshot (signals / proxies / branchSubs sizes). Parity with
     * Angular's emitProxyMetrics. Only fires when devtools is active. Throttling is the
     * caller's responsibility (matching Angular's metricsThrottleMs).
     */
    emitProxyMetrics() {
        if (!this.devActive)
            return;
        const metrics = this.reactivity?.getProxyMetrics?.();
        if (!metrics)
            return;
        this.devService?.emitProxyMetrics(this.name, metrics);
    }
    returnStore() { return this.store; }
    // Internal helpers exposed for bridge/advanced (parity with original createService surface)
    get _internalData() { return this.data; }
    /**
     * Runtime control of wake-up granularity.
     *
     * store.wakeUp('grained')     → only the exact changed path is dirtied (default, recommended)
     * store.wakeUp('container')   → also dirty parents on the path (more "container" behavior)
     * store.wakeUp('a.b.c', 'leaf') → Angular-compatible targeted branch wake for one path
     */
    setWakeMode(mode) {
        this.wakeUp(mode);
    }
    wakePath(path, mode = 'grained') {
        this.wakeUp(path, mode);
    }
    wakeUp(pathOrMode, mode) {
        if (mode === undefined && GLOBAL_WAKE_MODES.has(pathOrMode)) {
            const normalized = pathOrMode === 'fine' || pathOrMode === 'grained' || pathOrMode === 'exact' ? false : true;
            this._wakeParentsOnChange = normalized;
            return;
        }
        this.reactivity?.wakeSignalPath(pathOrMode, mode ?? 'grained');
    }
}
// --- Public factories (full parity surface) ---
export function createSolidStore(initial, name = 'default', options) {
    const prev = registry.get(name);
    if (prev)
        prev.destroy();
    return new SolidStore(initial, name, options);
}
export function useSolidStore(name = 'default') {
    const s = registry.get(name);
    if (!s)
        throw new Error(`[SolidStore] useSolidStore('${name}'): store not found. Create first.`);
    return s;
}
export function waitForStore(name = 'default', options = {}) {
    const existing = registry.get(name);
    if (existing)
        return Promise.resolve(existing);
    const abortError = () => Object.assign(new Error(`[SolidStore] waitForStore('${name}') aborted.`), { name: 'AbortError' });
    if (options.signal?.aborted)
        return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        let timer;
        const onAbort = () => finishReject(abortError());
        const waiters = registryWaiters.get(name) ?? new Set();
        const waiter = {
            resolve: (store) => resolve(store),
            reject,
            cleanup: () => {
                if (timer !== undefined)
                    clearTimeout(timer);
                options.signal?.removeEventListener('abort', onAbort);
            },
        };
        const finishReject = (error) => {
            waiters.delete(waiter);
            if (waiters.size === 0)
                registryWaiters.delete(name);
            waiter.cleanup();
            waiter.reject(error);
        };
        waiters.add(waiter);
        registryWaiters.set(name, waiters);
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (options.timeoutMs !== undefined) {
            const timeoutMs = Math.max(0, options.timeoutMs);
            timer = setTimeout(() => finishReject(new Error(`[SolidStore] waitForStore('${name}') timed out after ${timeoutMs}ms.`)), timeoutMs);
        }
    });
}
// Headless / vanilla friendly (no owner required for creation + plain reads/writes/mutate).
// For createMemo/createEffect over .store use createRoot in non-component usage.
export default SolidStore;
export { createSolidProxy } from '../proxy/solid-proxy.js';
//# sourceMappingURL=SolidStore.js.map