// Callable proxy, path-indexed reactivity, and store dispatch for Solid.
import { createSignal } from 'solid-js';
import { enumerateAncestors, getParentPath, isValidPath, normalizePath } from '../internal/path.js'; // delegates to SST (internal/path.ts) — all parent walks now reuse shared path core (max unification, zero naked path building)
import { ARRAY_METHODS } from '../array/solid-array.js';
import { createMutationResult } from '@adsq/jsnq/data-engine';
import { createProjectionObservable } from '../core/rx-interop.js';
function isDispatchMethod(method) {
    switch (method) {
        case 'mutate':
        case 'pipe':
        case 'array':
        case 'select':
        case 'query':
        case 'computedOf':
        case '$mutate':
        case '$pipe':
        case '$array':
        case '$select':
        case '$computedOf':
        case '$query':
        case '$queryOne':
        case '$liveQuery':
        case '$liveQueryOne':
            return true;
        default:
            return false;
    }
}
function isRootDispatchMethod(method) {
    switch (method) {
        case 'setValue':
        case 'readStore':
        case 'deleteValue':
        case 'wakeUp':
        case 'batch':
            return true;
        default:
            return false;
    }
}
function signalEquals(prev, next) {
    const prevIsObject = prev !== null && typeof prev === 'object';
    const nextIsObject = next !== null && typeof next === 'object';
    return !prevIsObject && !nextIsObject && Object.is(prev, next);
}
/**
 * SignalPathTrie — opinia3 #1 perf: branch wake in O(observed descendants of the
 * branch) instead of O(all observed signals) Set scan (SignalPathIndex above).
 *
 * Observed signal paths are stored as a segment trie split on '.', exactly the
 * dot-joined form the proxy builds via makeChildPath. descendantsOf(prefix) jumps
 * straight to the branch node and collects only present descendants — matching the
 * previous `path.startsWith(prefix + '.')` semantics (the prefix itself excluded).
 *
 * The index is internal; callers only see precise wake behavior.
 */
class SignalPathTrieNode {
    children = null;
    present = false;
}
class SignalPathTrie {
    root = new SignalPathTrieNode();
    add(path) {
        if (!path)
            return;
        let node = this.root;
        let start = 0;
        const len = path.length;
        for (let i = 0; i <= len; i++) {
            if (i === len || path.charCodeAt(i) === 46 /* '.' */) {
                const seg = path.slice(start, i);
                start = i + 1;
                let children = node.children;
                if (!children) {
                    children = new Map();
                    node.children = children;
                }
                let child = children.get(seg);
                if (!child) {
                    child = new SignalPathTrieNode();
                    children.set(seg, child);
                }
                node = child;
            }
        }
        node.present = true;
    }
    descendantsOf(pathPrefix) {
        if (!pathPrefix)
            return [];
        const node = this.nodeAt(pathPrefix);
        if (!node || !node.children)
            return [];
        const out = [];
        this.collect(node, pathPrefix, out, null);
        return out;
    }
    descendantsOfAny(pathPrefixes) {
        const valid = pathPrefixes.filter((path) => path.length > 0);
        if (valid.length === 0)
            return [];
        if (valid.length === 1)
            return this.descendantsOf(valid[0]);
        const out = [];
        const seen = new Set();
        for (const prefix of valid) {
            const node = this.nodeAt(prefix);
            if (node && node.children)
                this.collect(node, prefix, out, seen);
        }
        return out;
    }
    /**
     * Splice-precise descendants: like descendantsOf(arrayPath) but collects only the subtrees
     * of array indices >= startIndex. After splice(startIndex, …) the prefix [0, startIndex) keeps
     * both value AND index, so its signals must NOT be woken. Non-numeric children (defensive —
     * should not occur on arrays) are always included so correctness never regresses.
     */
    descendantsFromArrayIndex(arrayPath, startIndex) {
        if (!arrayPath)
            return [];
        const node = this.nodeAt(arrayPath);
        if (!node || !node.children)
            return [];
        const out = [];
        for (const [seg, child] of node.children) {
            const idx = Number(seg);
            if (Number.isInteger(idx) && idx < startIndex)
                continue; // untouched prefix — skip
            const childPath = `${arrayPath}.${seg}`;
            if (child.present)
                out.push(childPath);
            if (child.children)
                this.collect(child, childPath, out, null);
        }
        return out;
    }
    nodeAt(path) {
        let node = this.root;
        let start = 0;
        const len = path.length;
        for (let i = 0; i <= len && node; i++) {
            if (i === len || path.charCodeAt(i) === 46) {
                node = node.children?.get(path.slice(start, i));
                start = i + 1;
            }
        }
        return node;
    }
    /** Collect present descendant paths. When `seen` is provided, dedupes across overlapping prefixes. */
    collect(node, prefix, out, seen) {
        const children = node.children;
        if (!children)
            return;
        for (const [seg, child] of children) {
            const childPath = `${prefix}.${seg}`;
            if (child.present) {
                if (seen) {
                    if (!seen.has(childPath)) {
                        seen.add(childPath);
                        out.push(childPath);
                    }
                }
                else {
                    out.push(childPath);
                }
            }
            if (child.children)
                this.collect(child, childPath, out, seen);
        }
    }
}
class SolidProxyManager {
    mutator;
    opts;
    signals = new Map();
    // Trie-backed index keeps branch wake proportional to observed descendants.
    signalIndex = new SignalPathTrie();
    // opinia5: per-query branch subscriptions ($liveQuery / $subscribe). A path here means
    // "wake this branch signal whenever any descendant changes" — local branch tracking that
    // does NOT require flipping the whole store into container/wakeParents mode.
    branchSubs = new Map();
    proxies = new Map();
    arrayMethodHandlers = new Map();
    ancestorPathCache = new Map();
    finalization;
    static MAX_ANCESTOR_CACHE_SIZE = 1000;
    static MAX_CHILD_CACHE_SIZE = 256;
    constructor(mutator, opts = {}) {
        this.mutator = mutator;
        this.opts = opts;
        // Respect initial option for low-level usage
        if (opts.wakeParentsOnChange !== undefined) {
            this.mutator._wakeParentsOnChange = opts.wakeParentsOnChange;
        }
        if (typeof FinalizationRegistry !== 'undefined') {
            this.finalization = new FinalizationRegistry((path) => {
                if (!this.proxies.get(path)?.deref()) {
                    this.proxies.delete(path);
                    this.deleteArrayMethodHandlers(path);
                }
            });
        }
    }
    // Current wake mode is always read dynamically from the mutator.
    // This allows clean runtime switching via store.wakeUp(...)
    get shouldWakeParents() {
        return !!this.mutator._wakeParentsOnChange;
    }
    getSignal(path) {
        let s = this.signals.get(path);
        if (!s) {
            s = createSignal(this.mutator.read(path), { equals: signalEquals });
            this.signals.set(path, s);
            this.signalIndex.add(path);
        }
        return s;
    }
    // === Signal wake-up helpers (no naked logic) ===
    /** Central handler for updating a signal by path. Replaces repeated has/get/set blocks. */
    updateSignal(path) {
        this.setSignalValue(path, this.mutator.read(path));
    }
    setSignalValue(path, value) {
        if (this.signals.has(path)) {
            const [, set] = this.signals.get(path);
            set(value);
        }
        // Test hook (no-op in prod; enables precise granularity assertions without prototype hacks)
        this.opts._onSignalUpdate?.(path);
    }
    /** Wake only the exact signal for this path (fine-grained default). */
    wakeExact(path) {
        this.updateSignal(path);
    }
    wakePath(path, mode = 'grained') {
        const normalized = normalizePath(path);
        if (!normalized)
            return;
        const branchWake = mode === 'container' || mode === 'parents' || mode === 'leaf' || mode === 'branch';
        if (branchWake) {
            for (const target of this.getBranchWakeTargets(normalized))
                this.updateSignal(target);
            return;
        }
        this.wakeExact(normalized);
    }
    /** Shared internal walker for any operation that needs to visit parent paths.
     *  Fully reuses SST getParentPath (no manual segment concat, no goła logika).
     *  Visitation order: root-first (outer parents before immediate) to match prior ensure/wake semantics.
     */
    walkParentPaths(path, visitor) {
        for (const p of this.getParentWakeTargets(path))
            visitor(p);
    }
    getParentWakeTargets(path) {
        const normalized = normalizePath(path);
        const branchTargets = this.getBranchWakeTargets(normalized);
        return branchTargets.length > 0 && branchTargets[branchTargets.length - 1] === normalized
            ? branchTargets.slice(0, -1)
            : branchTargets;
    }
    getBranchWakeTargets(path) {
        const normalized = normalizePath(path);
        const cached = this.ancestorPathCache.get(normalized);
        if (cached)
            return cached;
        if (this.ancestorPathCache.size >= SolidProxyManager.MAX_ANCESTOR_CACHE_SIZE) {
            const first = this.ancestorPathCache.keys().next().value;
            if (first !== undefined)
                this.ancestorPathCache.delete(first);
        }
        const targets = [...enumerateAncestors(normalized)].reverse();
        this.ancestorPathCache.set(normalized, targets);
        return targets;
    }
    /** Creates the base callable + its getter for a path. */
    createBaseCallable(path) {
        const [get] = this.getSignal(path);
        const fn = (() => get());
        Object.defineProperty(fn, '$val', { get: () => get(), enumerable: false, configurable: true });
        Object.defineProperty(fn, '$signal', { get: () => get, enumerable: false, configurable: true });
        return { fn, get };
    }
    syncDescendants(pathPrefix) {
        for (const path of this.signalIndex.descendantsOf(pathPrefix))
            this.updateSignal(path);
    }
    syncDescendantsOfAny(pathPrefixes) {
        for (const path of this.signalIndex.descendantsOfAny(pathPrefixes))
            this.updateSignal(path);
    }
    /**
     * Precise splice wake (opt-in via SolidStore preciseMutationWake). Bounded analog of the
     * generic branch-replace path for splice(start>0): wakes the array signal + only the element
     * signals at index >= start (skipping the untouched [0,start) prefix) + branch subscribers on
     * the array path. The caller (SolidStore.#tryPreciseSplice) only routes here in grained mode;
     * container mode keeps the proven full syncDescendants path so ancestor/parents wake is
     * byte-for-byte identical to before. Defensive shouldWakeParents guard mirrors that contract.
     */
    wakeArraySplice(arrayPath, startIndex) {
        if (this.shouldWakeParents) {
            // Defensive: should never be reached (caller guards), but keep full parity if it is.
            this.syncDescendants(arrayPath);
        }
        else {
            for (const path of this.signalIndex.descendantsFromArrayIndex(arrayPath, startIndex)) {
                this.updateSignal(path);
            }
        }
        this.wakeExact(arrayPath);
        if (this.branchSubs.size > 0)
            this.wakeBranchSubscribers([arrayPath]);
    }
    /** Allocation-free wake path for O(1) push/pop tail mutations. */
    wakeArrayTail(arrayPath, index, branchReplaced) {
        const indexPath = `${arrayPath}.${index}`;
        if (branchReplaced)
            this.syncDescendants(indexPath);
        this.wakeExact(arrayPath);
        this.wakeExact(indexPath);
        if (this.shouldWakeParents) {
            for (const path of this.getParentWakeTargets(indexPath)) {
                if (path !== arrayPath)
                    this.updateSignal(path);
            }
        }
        if (this.branchSubs.size > 0)
            this.wakeBranchSubscribers([arrayPath, indexPath]);
    }
    isBranchMutation(value) {
        return value !== null && typeof value === 'object';
    }
    wakeFromMutation(result) {
        if (result.branchReplaced)
            this.syncDescendants(result.path);
        if (result.changed.length === 1 && result.inserted.length === 0 && result.deleted.length === 0) {
            this.wakeExact(result.changed[0]);
        }
        else {
            const exactPaths = new Set([...result.changed, ...result.inserted, ...result.deleted]);
            for (const path of exactPaths)
                this.wakeExact(path);
        }
        if (this.shouldWakeParents) {
            for (const path of result.parents)
                this.updateSignal(path);
        }
        if (this.branchSubs.size > 0) {
            this.wakeBranchSubscribers([...result.changed, ...result.inserted, ...result.deleted, result.path]);
        }
    }
    wakeFromMutations(results) {
        if (results.length === 1) {
            this.wakeFromMutation(results[0]);
            return;
        }
        const branchPaths = [];
        const exactPaths = new Set();
        const parentPaths = new Set();
        for (const result of results) {
            if (result.branchReplaced)
                branchPaths.push(result.path);
            for (const path of result.changed)
                exactPaths.add(path);
            for (const path of result.inserted)
                exactPaths.add(path);
            for (const path of result.deleted)
                exactPaths.add(path);
            if (this.shouldWakeParents) {
                for (const path of result.parents)
                    parentPaths.add(path);
            }
        }
        this.syncDescendantsOfAny(branchPaths);
        for (const path of exactPaths)
            this.wakeExact(path);
        for (const path of parentPaths)
            this.updateSignal(path);
        if (this.branchSubs.size > 0)
            this.wakeBranchSubscribers(exactPaths);
    }
    // opinia5: register/unregister a branch as "interested in all descendants" (per-query, ref-counted).
    addBranchSub(path) {
        const key = normalizePath(path);
        this.branchSubs.set(key, (this.branchSubs.get(key) ?? 0) + 1);
    }
    removeBranchSub(path) {
        const key = normalizePath(path);
        const next = (this.branchSubs.get(key) ?? 0) - 1;
        if (next <= 0)
            this.branchSubs.delete(key);
        else
            this.branchSubs.set(key, next);
    }
    // Wake any registered branch signal that is an ancestor-or-self of a changed path. Only the
    // exact branch signal is dirtied (not its whole subtree) — that branch's $liveQuery memo then
    // recomputes once. Cost is O(changed paths × depth), and only when branchSubs is non-empty.
    wakeBranchSubscribers(changedPaths) {
        const woken = new Set();
        const wakeIfRegistered = (candidate) => {
            if (candidate.length === 0) {
                if (this.branchSubs.has('') && !woken.has('')) {
                    woken.add('');
                    this.updateSignal('');
                }
                return;
            }
            if (this.branchSubs.has(candidate) && !woken.has(candidate)) {
                woken.add(candidate);
                this.updateSignal(candidate);
            }
        };
        if (this.branchSubs.has(''))
            wakeIfRegistered('');
        for (const path of changedPaths) {
            if (!path)
                continue;
            wakeIfRegistered(path);
            for (const ancestor of this.getBranchWakeTargets(path))
                wakeIfRegistered(ancestor);
        }
    }
    wakeMutation(result) {
        this.wakeFromMutation(result);
    }
    wakeMutations(results) {
        this.wakeFromMutations(results);
    }
    /** Snapshot of proxy-graph sizes for devtools PROXY_METRICS emission (Angular parity). */
    metrics() {
        return { signals: this.signals.size, proxies: this.proxies.size, branchSubs: this.branchSubs.size };
    }
    destroy() {
        this.signals.clear();
        this.signalIndex = new SignalPathTrie();
        this.branchSubs.clear();
        this.proxies.clear();
        this.arrayMethodHandlers.clear();
        this.ancestorPathCache.clear();
        this.finalization = undefined;
    }
    /** Ensure all parent proxies exist for a deep path (part of navigation/wake-up). */
    ensureIntermediates(path, factory) {
        if (!path.includes('.'))
            return;
        this.walkParentPaths(path, (current) => {
            if (!this.getCachedProxy(current)) {
                factory(current);
            }
            this.mutator.prefetch(current);
        });
    }
    make(path, factory) {
        const cached = this.getCachedProxy(path);
        if (cached)
            return cached;
        const { fn, get } = this.createBaseCallable(path);
        const h = this.createProxyHandler(path, get, factory);
        const px = new Proxy(fn, h);
        this.registerProxy(path, px);
        this.ensureIntermediates(path, factory);
        return px;
    }
    /**
     * Creates the full ProxyHandler for a path.
     * All special property logic is now handled via small maps + dedicated helper methods
     * instead of long if-chains (no more goła logika).
     */
    createProxyHandler(path, get, factory) {
        const self = this;
        const childCache = Object.create(null);
        let childCacheSize = 0;
        return {
            get(_, k) {
                if (typeof k === 'symbol') {
                    return self.handleSymbolProperty(k, get);
                }
                const ks = String(k);
                switch (ks) {
                    case '$val':
                        return get();
                    case 'toString':
                        return () => String(get());
                    case 'valueOf':
                    case 'toJSON':
                        return get;
                    case '$signal':
                        return get;
                    case 'length': {
                        const value = get();
                        return Array.isArray(value) ? value.length : undefined;
                    }
                }
                // opinia5: $subscribe(cb, options) on any node — observe this path's value. Registers
                // branch interest so a subscription on an object/array also fires on descendant changes,
                // without flipping the whole store into container mode. Returns { unsubscribe, dispose }.
                if (ks === '$subscribe') {
                    return (cb, options) => self.subscribePath(path, get, cb, options);
                }
                if (path === '' && isRootDispatchMethod(ks)) {
                    return self.createRootDispatchHandler(ks);
                }
                // Dispatch methods (mutate, array, computedOf, etc.)
                // opinia5: $-prefixed aliases so a data key literally named `mutate`/`query`/`select`/… does
                // not shadow the store operations. Back-compat: bare names stay.
                if (isDispatchMethod(ks)) {
                    const cp = self.makeChildPath(path, ks);
                    return self.createDispatchHandler(cp, ks);
                }
                // Array mutation / query methods
                if (ARRAY_METHODS.has(ks)) {
                    return self.createArrayMethodHandler(path, ks, get);
                }
                // Child proxy identity is stable for the store lifetime. A per-parent cache
                // avoids rebuilding the full path and consulting the global map on every read.
                const cached = childCache[ks];
                if (cached)
                    return cached;
                const child = factory(self.makeChildPath(path, ks));
                if (childCacheSize >= SolidProxyManager.MAX_CHILD_CACHE_SIZE) {
                    for (const key in childCache)
                        delete childCache[key];
                    childCacheSize = 0;
                }
                childCache[ks] = child;
                childCacheSize++;
                return child;
            },
            set(_, k, v) {
                return self.handleSet(path, k, v);
            },
            deleteProperty(_, k) {
                return self.handleDelete(path, k);
            }
        };
    }
    /** Central place for registering a new proxy (cache + initial prefetch). */
    registerProxy(path, px) {
        this.proxies.set(path, new WeakRef(px));
        this.finalization?.register(px, path);
        this.mutator.prefetch(path);
    }
    getCachedProxy(path) {
        const proxy = this.proxies.get(path)?.deref();
        if (!proxy)
            this.proxies.delete(path);
        return proxy;
    }
    deleteArrayMethodHandlers(path) {
        const prefix = `${path}\u0000`;
        for (const key of this.arrayMethodHandlers.keys()) {
            if (key.startsWith(prefix))
                this.arrayMethodHandlers.delete(key);
        }
    }
    // Small public-for-root helpers so root creation can stay clean without bracket hacks
    createRootCallable() {
        return this.createBaseCallable('');
    }
    createRootHandler(factory) {
        const { get } = this.createBaseCallable('');
        return this.createProxyHandler('', get, factory);
    }
    /** Central helper: constructs child path string. Eliminates repeated naked `${path}.${k}` templates. */
    makeChildPath(parent, key) {
        return parent ? `${parent}.${key}` : key;
    }
    // === Small focused handlers (no naked if cascades) ===
    handleSymbolProperty(k, get) {
        if (k === Symbol.toPrimitive) {
            return (hint) => {
                const v = get();
                return typeof v === 'object' ? (hint === 'number' ? NaN : JSON.stringify(v)) : v;
            };
        }
        if (k === Symbol.toStringTag) {
            return () => {
                const v = get();
                try {
                    return typeof v === 'object' ? JSON.stringify(v) : String(v);
                }
                catch {
                    return String(v);
                }
            };
        }
        return undefined;
    }
    createDispatchHandler(cp, method) {
        const self = this;
        return (...args) => {
            // $-alias resolution: use the exact method when defined ($query/$queryOne/$liveQuery/
            // $liveQueryOne are dedicated SolidStore methods), otherwise strip the leading '$' and use
            // the bare method ($mutate -> mutate, $select -> select, …).
            const mutatorAny = self.mutator;
            const m = typeof mutatorAny[method] === 'function'
                ? mutatorAny[method]
                : mutatorAny[method.charCodeAt(0) === 36 /* '$' */ ? method.slice(1) : method];
            const parentPath = getParentPath(cp) ?? '';
            self.mutator.emitDevAction({ type: 'PROXY_DISPATCH', payload: { path: parentPath, method } });
            return typeof m === 'function' ? m.call(self.mutator, parentPath, ...args) : undefined;
        };
    }
    // opinia5: value subscription for a path (backs $subscribe). Registers branch interest so a
    // subscription on an object/array also fires on descendant mutations, then cleans it up.
    subscribePath(path, get, cb, options) {
        this.addBranchSub(path);
        const sub = createProjectionObservable(get, options).subscribe(cb);
        let closed = false;
        const close = () => {
            if (closed)
                return;
            closed = true;
            sub.unsubscribe();
            this.removeBranchSub(path);
        };
        return { unsubscribe: close, dispose: close };
    }
    createRootDispatchHandler(method) {
        const self = this;
        return (...args) => {
            self.mutator.emitDevAction({ type: 'PROXY_DISPATCH', payload: { path: '', method } });
            const m = self.mutator[method];
            return typeof m === 'function' ? m.call(self.mutator, ...args) : undefined;
        };
    }
    createArrayMethodHandler(path, method, get) {
        const cacheKey = `${path}\u0000${method}`;
        const cached = this.arrayMethodHandlers.get(cacheKey);
        if (cached)
            return cached;
        const self = this;
        const handler = (...args) => {
            self.mutator.emitDevAction({ type: 'ARRAY_DISPATCH', payload: { path, method, args } });
            return self.mutator.arrayOp?.(path, method, args, get());
        };
        this.arrayMethodHandlers.set(cacheKey, handler);
        return handler;
    }
    handleSet(path, k, v) {
        if (typeof k === 'symbol')
            return false;
        const tp = this.makeChildPath(path, String(k));
        if (v === undefined && this.opts.strictDeleteUndefined) {
            throw new Error(`strict: set undefined ${tp}`);
        }
        if (this.opts.strictInvalidPath && !isValidPath(tp)) {
            throw new Error(`strict: invalid path ${tp}`);
        }
        const writeAndSync = () => {
            const result = v === undefined ? this.mutator.delete(tp) : this.mutator.write(tp, v);
            this.wakeFromMutation(result);
        };
        if (this.isSinglePrimitiveLeafSet(v)) {
            writeAndSync();
        }
        else {
            this.mutator.batch(writeAndSync);
        }
        this.mutator.emitDevAction({ type: 'SET_VALUE', payload: { path: tp, value: v } });
        return true;
    }
    isSinglePrimitiveLeafSet(value) {
        return value !== undefined && !this.isBranchMutation(value) && !this.shouldWakeParents;
    }
    handleDelete(path, k) {
        if (typeof k === 'symbol')
            return false;
        const tp = this.makeChildPath(path, String(k));
        if (this.opts.strictDeleteUndefined) {
            throw new Error(`strict: delete ${tp}`);
        }
        if (this.opts.strictInvalidPath && !isValidPath(tp)) {
            throw new Error(`strict: invalid path ${tp}`);
        }
        this.mutator.batch(() => this.wakeFromMutation(this.mutator.delete(tp)));
        this.mutator.emitDevAction({ type: 'DELETE', payload: { path: tp } });
        return true;
    }
}
export function createSolidProxy(mutator, options = {}) {
    const mgr = new SolidProxyManager(mutator, options);
    // Typed reactivity binding (replaces six `(mutator as any).__wakeX = ...` casts).
    mutator.bindReactivity?.({
        wakeMutation: (result) => mgr.wakeMutation(result),
        wakeMutations: (results) => mgr.wakeMutations(results),
        wakeArrayTail: (arrayPath, index, branchReplaced) => mgr.wakeArrayTail(arrayPath, index, branchReplaced),
        wakeArraySplice: (arrayPath, startIndex) => mgr.wakeArraySplice(arrayPath, startIndex),
        addBranchSub: (path) => mgr.addBranchSub(path),
        removeBranchSub: (path) => mgr.removeBranchSub(path),
        wakeSignalPath: (path, mode) => mgr.wakePath(path, mode),
        getProxyMetrics: () => mgr.metrics(),
        destroy: () => mgr.destroy(),
    });
    const fac = (p) => mgr.make(p, fac);
    return mgr.make('', fac);
}
export function createStoreMutator(base) {
    return {
        read: base.read,
        write: (p, v) => {
            const previous = base.read(p);
            const result = base.write(p, v);
            return result ?? createMutationResult({
                path: p,
                kind: 'set',
                previous,
                next: v,
                existed: previous !== undefined,
                changed: [p],
                inserted: previous === undefined ? [p] : [],
                branchReplaced: (previous !== null && typeof previous === 'object') || (v !== null && typeof v === 'object'),
                affectedPaths: [p],
            });
        },
        batch: base.batch ?? (f => f()),
        delete: base.delete ?? ((p) => {
            const previous = base.read(p);
            const result = base.write(p, undefined);
            return result ?? createMutationResult({
                path: p,
                kind: 'delete',
                previous,
                existed: previous !== undefined,
                deleted: previous !== undefined ? [p] : [],
                branchReplaced: previous !== null && typeof previous === 'object',
                affectedPaths: [p],
            });
        }),
        prefetch: base.prefetch ?? (() => { }),
        emitDevAction: base.emitDevAction ?? (() => { }),
        cleanupPath: base.cleanupPath ?? (() => { }),
    };
}
//# sourceMappingURL=solid-proxy.js.map