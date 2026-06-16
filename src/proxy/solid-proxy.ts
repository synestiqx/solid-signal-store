// HARD LIMIT: 320 LOC. Follows PLAN.md v2 + Critic requirements. Proxy identity, prefetch side-effects, full callable getters for auto-tracking.

import { createSignal, batch, type Accessor, type Setter } from 'solid-js';
import { enumerateAncestors, getParentPath, isValidPath, normalizePath } from '../internal/path'; // delegates to SST (internal/path.ts) — all parent walks now reuse shared path core (max unification, zero naked path building)
import { ARRAY_METHODS } from '../array/solid-array';
import { createMutationResult, type JsonMutationResult } from '@synestiqx/jsondb/data-engine';
import { createProjectionObservable, type ProjectionObservableOptions } from '../core/rx-interop';

export interface StoreMutator {
  read(path: string): unknown;
  write(path: string, value: unknown): JsonMutationResult;
  batch<T>(fn: () => T): T;
  delete(path: string): JsonMutationResult;
  prefetch(pathPrefix: string): void;
  emitDevAction(action: any): void;
  cleanupPath(path: string): void;
}

export type SolidWakeMode = 'grained' | 'fine' | 'exact' | 'container' | 'parents' | 'leaf' | 'branch';

export interface SolidProxyOptions {
  strictInvalidPath?: boolean;
  strictDeleteUndefined?: boolean;

  /**
   * Controls wake-up behavior after mutations.
   *
   * - false (default): Maximum granularity. Only the exact changed leaf signal is dirtied.
   *   Solid automatically notifies only the memos/effects that read that precise path.
   *   This is the "fine-grained Solid way".
   *
   * - true: Container-style (legacy behavior). On change we also walk and dirty parent signals
   *   on the path. Useful if you have code that relies on parent-level effects firing when
   *   anything inside changes.
   *
   * Recommendation: keep default (false) for best performance and granularity.
   */
  wakeParentsOnChange?: boolean;

  /**
   * @internal Test-only instrumentation hook.
   * Allows verify.ts (and future harnesses) to observe exactly which paths trigger signal updates.
   * Zero impact on production paths. Enables real measurement of grained vs container wakeUp behavior.
   */
  _onSignalUpdate?: (path: string) => void;
}

type P = any;

function isDispatchMethod(method: string): boolean {
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

function isRootDispatchMethod(method: string): boolean {
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

function signalEquals(prev: unknown, next: unknown): boolean {
  const prevIsObject = prev !== null && typeof prev === 'object';
  const nextIsObject = next !== null && typeof next === 'object';
  return !prevIsObject && !nextIsObject && Object.is(prev, next);
}

class SignalPathIndex {
  private readonly paths = new Set<string>();

  add(path: string): void {
    this.paths.add(path);
  }

  delete(path: string): void {
    this.paths.delete(path);
  }

  descendantsOf(pathPrefix: string): string[] {
    const prefix = pathPrefix ? `${pathPrefix}.` : '';
    if (!prefix) return [];
    const out: string[] = [];
    for (const path of this.paths) {
      if (path.startsWith(prefix)) out.push(path);
    }
    return out;
  }

  descendantsOfAny(pathPrefixes: readonly string[]): string[] {
    const prefixes = pathPrefixes
      .filter((path) => path.length > 0)
      .map((path) => `${path}.`);
    if (prefixes.length === 0) return [];

    const out: string[] = [];
    for (const path of this.paths) {
      for (const prefix of prefixes) {
        if (path.startsWith(prefix)) {
          out.push(path);
          break;
        }
      }
    }
    return out;
  }
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
 * Drop-in replacement: identical public surface (add / delete / descendantsOf /
 * descendantsOfAny). To revert, swap `new SignalPathTrie()` back to
 * `new SignalPathIndex()` in SolidProxyManager below — the old class is kept intact.
 */
class SignalPathTrieNode {
  children: Map<string, SignalPathTrieNode> | null = null;
  present = false;
}

class SignalPathTrie {
  private readonly root = new SignalPathTrieNode();

  add(path: string): void {
    if (!path) return;
    let node = this.root;
    let start = 0;
    const len = path.length;
    for (let i = 0; i <= len; i++) {
      if (i === len || path.charCodeAt(i) === 46 /* '.' */) {
        const seg = path.slice(start, i);
        start = i + 1;
        let children = node.children;
        if (!children) { children = new Map(); node.children = children; }
        let child = children.get(seg);
        if (!child) { child = new SignalPathTrieNode(); children.set(seg, child); }
        node = child;
      }
    }
    node.present = true;
  }

  delete(path: string): void {
    if (!path) return;
    const segs = path.split('.');
    const chain: SignalPathTrieNode[] = [this.root];
    let node = this.root;
    for (const seg of segs) {
      const child = node.children?.get(seg);
      if (!child) return; // path was never indexed
      chain.push(child);
      node = child;
    }
    node.present = false;
    // Prune now-empty leaf nodes bottom-up to keep the trie compact.
    for (let i = chain.length - 1; i > 0; i--) {
      const child = chain[i]!;
      if (child.present || (child.children && child.children.size > 0)) break;
      chain[i - 1]!.children?.delete(segs[i - 1]!);
    }
  }

  descendantsOf(pathPrefix: string): string[] {
    if (!pathPrefix) return [];
    const node = this.nodeAt(pathPrefix);
    if (!node || !node.children) return [];
    const out: string[] = [];
    this.collect(node, pathPrefix, out, null);
    return out;
  }

  descendantsOfAny(pathPrefixes: readonly string[]): string[] {
    const valid = pathPrefixes.filter((path) => path.length > 0);
    if (valid.length === 0) return [];
    if (valid.length === 1) return this.descendantsOf(valid[0]!);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const prefix of valid) {
      const node = this.nodeAt(prefix);
      if (node && node.children) this.collect(node, prefix, out, seen);
    }
    return out;
  }

  private nodeAt(path: string): SignalPathTrieNode | undefined {
    let node: SignalPathTrieNode | undefined = this.root;
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
  private collect(node: SignalPathTrieNode, prefix: string, out: string[], seen: Set<string> | null): void {
    const children = node.children;
    if (!children) return;
    for (const [seg, child] of children) {
      const childPath = `${prefix}.${seg}`;
      if (child.present) {
        if (seen) {
          if (!seen.has(childPath)) { seen.add(childPath); out.push(childPath); }
        } else {
          out.push(childPath);
        }
      }
      if (child.children) this.collect(child, childPath, out, seen);
    }
  }
}

class SolidProxyManager {
  private signals = new Map<string, [Accessor<unknown>, Setter<unknown>]>();
  // opinia3 #1: trie-backed index (O(branch descendants) wake). Revert: `new SignalPathIndex()`.
  private signalIndex = new SignalPathTrie();
  // opinia5: per-query branch subscriptions ($liveQuery / $subscribe). A path here means
  // "wake this branch signal whenever any descendant changes" — local branch tracking that
  // does NOT require flipping the whole store into container/wakeParents mode.
  private branchSubs = new Map<string, number>();
  private proxies = new Map<string, P>();
  private arrayMethodHandlers = new Map<string, Function>();
  private ancestorPathCache = new Map<string, string[]>();
  private finalization?: FinalizationRegistry<string>;
  private static readonly MAX_ANCESTOR_CACHE_SIZE = 1000;

  constructor(private mutator: StoreMutator, private opts: SolidProxyOptions = {}) {
    // Respect initial option for low-level usage
    if (opts.wakeParentsOnChange !== undefined) {
      (mutator as any)._wakeParentsOnChange = opts.wakeParentsOnChange;
    }

    if (typeof FinalizationRegistry !== 'undefined') {
      this.finalization = new FinalizationRegistry((path: string) => {
        this.mutator.cleanupPath(path);
        this.signals.delete(path);
        this.signalIndex.delete(path);
        this.proxies.delete(path);
        this.deleteArrayMethodHandlers(path);
      });
    }
  }

  // Current wake mode is always read dynamically from the mutator.
  // This allows clean runtime switching via store.wakeUp(...)
  private get shouldWakeParents(): boolean {
    return !!(this.mutator as any)._wakeParentsOnChange;
  }

  private getSignal(path: string): [Accessor<unknown>, Setter<unknown>] {
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
  private updateSignal(path: string): void {
    this.setSignalValue(path, this.mutator.read(path));
  }

  private setSignalValue(path: string, value: unknown): void {
    if (this.signals.has(path)) {
      const [, set] = this.signals.get(path)!;
      set(value);
    }
    // Test hook (no-op in prod; enables precise granularity assertions without prototype hacks)
    (this.opts as any)._onSignalUpdate?.(path);
  }

  /** Wake only the exact signal for this path (fine-grained default). */
  private wakeExact(path: string): void {
    this.updateSignal(path);
  }

  wakePath(path: string, mode: SolidWakeMode = 'grained'): void {
    const normalized = normalizePath(path);
    if (!normalized) return;
    const branchWake = mode === 'container' || mode === 'parents' || mode === 'leaf' || mode === 'branch';
    if (branchWake) {
      for (const target of this.getBranchWakeTargets(normalized)) this.updateSignal(target);
      return;
    }
    this.wakeExact(normalized);
  }

  /** Shared internal walker for any operation that needs to visit parent paths.
   *  Fully reuses SST getParentPath (no manual segment concat, no goła logika).
   *  Visitation order: root-first (outer parents before immediate) to match prior ensure/wake semantics.
   */
  private walkParentPaths(path: string, visitor: (currentPath: string) => void): void {
    for (const p of this.getParentWakeTargets(path)) visitor(p);
  }

  private getParentWakeTargets(path: string): string[] {
    const normalized = normalizePath(path);
    const branchTargets = this.getBranchWakeTargets(normalized);
    return branchTargets.length > 0 && branchTargets[branchTargets.length - 1] === normalized
      ? branchTargets.slice(0, -1)
      : branchTargets;
  }

  private getBranchWakeTargets(path: string): string[] {
    const normalized = normalizePath(path);
    const cached = this.ancestorPathCache.get(normalized);
    if (cached) return cached;
    if (this.ancestorPathCache.size >= SolidProxyManager.MAX_ANCESTOR_CACHE_SIZE) {
      const first = this.ancestorPathCache.keys().next().value;
      if (first !== undefined) this.ancestorPathCache.delete(first);
    }
    const targets = [...enumerateAncestors(normalized)].reverse();
    this.ancestorPathCache.set(normalized, targets);
    return targets;
  }

  /** Creates the base callable + its getter for a path. */
  private createBaseCallable(path: string): { fn: P; get: () => unknown } {
    const [get] = this.getSignal(path);
    const fn = (() => get()) as P;
    Object.defineProperty(fn, '$val', { get: () => get(), enumerable: false, configurable: true });
    Object.defineProperty(fn, '$signal', { get: () => get, enumerable: false, configurable: true });
    return { fn, get };
  }

  private syncDescendants(pathPrefix: string): void {
    for (const path of this.signalIndex.descendantsOf(pathPrefix)) this.updateSignal(path);
  }

  private syncDescendantsOfAny(pathPrefixes: readonly string[]): void {
    for (const path of this.signalIndex.descendantsOfAny(pathPrefixes)) this.updateSignal(path);
  }


  private isBranchMutation(value: unknown): boolean {
    return value !== null && typeof value === 'object';
  }

  private wakeFromMutation(result: JsonMutationResult): void {
    if (result.branchReplaced) this.syncDescendants(result.path);
    if (result.changed.length === 1 && result.inserted.length === 0 && result.deleted.length === 0) {
      this.wakeExact(result.changed[0]!);
    } else {
      const exactPaths = new Set([...result.changed, ...result.inserted, ...result.deleted]);
      for (const path of exactPaths) this.wakeExact(path);
    }
    if (this.shouldWakeParents) {
      for (const path of result.parents) this.updateSignal(path);
    }
    if (this.branchSubs.size > 0) {
      this.wakeBranchSubscribers([...result.changed, ...result.inserted, ...result.deleted, result.path]);
    }
  }

  private wakeFromMutations(results: readonly JsonMutationResult[]): void {
    if (results.length === 1) {
      this.wakeFromMutation(results[0]!);
      return;
    }

    const branchPaths: string[] = [];
    const exactPaths = new Set<string>();
    const parentPaths = new Set<string>();

    for (const result of results) {
      if (result.branchReplaced) branchPaths.push(result.path);
      for (const path of result.changed) exactPaths.add(path);
      for (const path of result.inserted) exactPaths.add(path);
      for (const path of result.deleted) exactPaths.add(path);
      if (this.shouldWakeParents) {
        for (const path of result.parents) parentPaths.add(path);
      }
    }

    this.syncDescendantsOfAny(branchPaths);
    for (const path of exactPaths) this.wakeExact(path);
    for (const path of parentPaths) this.updateSignal(path);
    if (this.branchSubs.size > 0) this.wakeBranchSubscribers(exactPaths);
  }

  // opinia5: register/unregister a branch as "interested in all descendants" (per-query, ref-counted).
  addBranchSub(path: string): void {
    const key = normalizePath(path);
    this.branchSubs.set(key, (this.branchSubs.get(key) ?? 0) + 1);
  }

  removeBranchSub(path: string): void {
    const key = normalizePath(path);
    const next = (this.branchSubs.get(key) ?? 0) - 1;
    if (next <= 0) this.branchSubs.delete(key);
    else this.branchSubs.set(key, next);
  }

  // Wake any registered branch signal that is an ancestor-or-self of a changed path. Only the
  // exact branch signal is dirtied (not its whole subtree) — that branch's $liveQuery memo then
  // recomputes once. Cost is O(changed paths × depth), and only when branchSubs is non-empty.
  private wakeBranchSubscribers(changedPaths: Iterable<string>): void {
    const woken = new Set<string>();
    const wakeIfRegistered = (candidate: string) => {
      if (candidate.length === 0) {
        if (this.branchSubs.has('') && !woken.has('')) { woken.add(''); this.updateSignal(''); }
        return;
      }
      if (this.branchSubs.has(candidate) && !woken.has(candidate)) {
        woken.add(candidate);
        this.updateSignal(candidate);
      }
    };
    if (this.branchSubs.has('')) wakeIfRegistered('');
    for (const path of changedPaths) {
      if (!path) continue;
      wakeIfRegistered(path);
      for (const ancestor of this.getBranchWakeTargets(path)) wakeIfRegistered(ancestor);
    }
  }

  wakeMutation(result: JsonMutationResult): void {
    this.wakeFromMutation(result);
  }

  wakeMutations(results: readonly JsonMutationResult[]): void {
    this.wakeFromMutations(results);
  }

  /** Ensure all parent proxies exist for a deep path (part of navigation/wake-up). */
  private ensureIntermediates(path: string, factory: (p: string) => P): void {
    if (!path.includes('.')) return;

    this.walkParentPaths(path, (current) => {
      if (!this.proxies.has(current)) {
        factory(current);
      }
      this.mutator.prefetch(current);
    });
  }

  make(path: string, factory: (p: string) => P): P {
    if (this.proxies.has(path)) {
      return this.proxies.get(path)!;
    }

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
  private createProxyHandler(
    path: string,
    get: () => unknown,
    factory: (p: string) => P
  ): ProxyHandler<object> {
    const self = this;

    return {
      get(_: object, k: PropertyKey) {
        if (typeof k === 'symbol') {
          return self.handleSymbolProperty(k, get);
        }

        const ks = String(k);
        const cp = self.makeChildPath(path, ks);

        switch (ks) {
          case '$val':
          case 'toString':
          case 'valueOf':
          case 'toJSON':
            return get();
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
          return (cb: (value: unknown) => void, options?: ProjectionObservableOptions<unknown>) =>
            self.subscribePath(path, get, cb, options);
        }

        if (path === '' && isRootDispatchMethod(ks)) {
          return self.createRootDispatchHandler(ks);
        }

        // Dispatch methods (mutate, array, computedOf, etc.)
        // opinia5: $-prefixed aliases so a data key literally named `mutate`/`query`/`select`/… does
        // not shadow the store operations. Back-compat: bare names stay.
        if (isDispatchMethod(ks)) {
          return self.createDispatchHandler(cp, ks);
        }

        // Array mutation / query methods
        if (ARRAY_METHODS.has(ks)) {
          return self.createArrayMethodHandler(path, ks);
        }

        // Default: create child proxy
        return factory(cp);
      },

      set(_: object, k: PropertyKey, v: unknown) {
        return self.handleSet(path, k, v);
      },

      deleteProperty(_: object, k: PropertyKey) {
        return self.handleDelete(path, k);
      }
    };
  }

  /** Central place for registering a new proxy (cache + GC cleanup + initial prefetch). */
  private registerProxy(path: string, px: P): void {
    this.proxies.set(path, px);
    if (this.finalization) {
      this.finalization.register(px, path);
    }
    this.mutator.prefetch(path);
  }

  private deleteArrayMethodHandlers(path: string): void {
    const prefix = `${path}\u0000`;
    for (const key of this.arrayMethodHandlers.keys()) {
      if (key.startsWith(prefix)) this.arrayMethodHandlers.delete(key);
    }
  }

  // Small public-for-root helpers so root creation can stay clean without bracket hacks
  createRootCallable() {
    return this.createBaseCallable('');
  }

  createRootHandler(factory: (p: string) => P) {
    const { get } = this.createBaseCallable('');
    return this.createProxyHandler('', get, factory);
  }

  /** Central helper: constructs child path string. Eliminates repeated naked `${path}.${k}` templates. */
  private makeChildPath(parent: string, key: string): string {
    return parent ? `${parent}.${key}` : key;
  }

  // === Small focused handlers (no naked if cascades) ===

  private handleSymbolProperty(k: symbol, get: () => unknown): any {
    if (k === Symbol.toPrimitive) {
      return (hint: string) => {
        const v = get();
        return typeof v === 'object' ? (hint === 'number' ? NaN : JSON.stringify(v)) : v;
      };
    }
    if (k === Symbol.toStringTag) {
      return () => {
        const v = get();
        try { return typeof v === 'object' ? JSON.stringify(v) : String(v); } catch { return String(v); }
      };
    }
    return undefined;
  }

  private createDispatchHandler(cp: string, method: string): Function {
    const self = this;
    return (...args: unknown[]) => {
      // $-alias resolution: use the exact method when defined ($query/$queryOne/$liveQuery/
      // $liveQueryOne are dedicated SolidStore methods), otherwise strip the leading '$' and use
      // the bare method ($mutate -> mutate, $select -> select, …).
      const mutatorAny = self.mutator as any;
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
  private subscribePath(
    path: string,
    get: () => unknown,
    cb: (value: unknown) => void,
    options?: ProjectionObservableOptions<unknown>
  ): { unsubscribe(): void; dispose(): void } {
    this.addBranchSub(path);
    const sub = createProjectionObservable(get, options).subscribe(cb);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      sub.unsubscribe();
      this.removeBranchSub(path);
    };
    return { unsubscribe: close, dispose: close };
  }

  private createRootDispatchHandler(method: string): Function {
    const self = this;
    return (...args: unknown[]) => {
      self.mutator.emitDevAction({ type: 'PROXY_DISPATCH', payload: { path: '', method } });
      const m = (self.mutator as any)[method];
      return typeof m === 'function' ? m.call(self.mutator, ...args) : undefined;
    };
  }

  private createArrayMethodHandler(path: string, method: string): Function {
    const cacheKey = `${path}\u0000${method}`;
    const cached = this.arrayMethodHandlers.get(cacheKey);
    if (cached) return cached;

    const self = this;
    const handler = (...args: unknown[]) => {
      self.mutator.emitDevAction({ type: 'ARRAY_DISPATCH', payload: { path, method, args } });
      return (self.mutator as any).arrayOp?.(path, method, args);
    };
    this.arrayMethodHandlers.set(cacheKey, handler);
    return handler;
  }

  private handleSet(path: string, k: PropertyKey, v: unknown): boolean {
    if (typeof k === 'symbol') return false;

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
    } else {
      this.mutator.batch(writeAndSync);
    }

    this.mutator.emitDevAction({ type: 'SET_VALUE', payload: { path: tp, value: v } });
    return true;
  }

  private isSinglePrimitiveLeafSet(value: unknown): boolean {
    return value !== undefined && !this.isBranchMutation(value) && !this.shouldWakeParents;
  }

  private handleDelete(path: string, k: PropertyKey): boolean {
    if (typeof k === 'symbol') return false;

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

export function createSolidProxy<T>(mutator: StoreMutator, options: SolidProxyOptions = {}): T {
  const mgr = new SolidProxyManager(mutator, options);
  (mutator as any).__wakeSignalPath = (path: string, mode?: SolidWakeMode) => mgr.wakePath(path, mode);
  (mutator as any).__wakeMutationResult = (result: JsonMutationResult) => mgr.wakeMutation(result);
  (mutator as any).__wakeMutationResults = (results: JsonMutationResult[]) => mgr.wakeMutations(results);
  // opinia5: let the store register/unregister per-query branch interest (for $liveQuery).
  (mutator as any).__addBranchSub = (path: string) => mgr.addBranchSub(path);
  (mutator as any).__removeBranchSub = (path: string) => mgr.removeBranchSub(path);
  const fac = (p: string) => mgr.make(p, fac);
  return mgr.make('', fac) as T;
}

export function createStoreMutator(base: {
  read(p: string): unknown;
  write(p: string, v: unknown): void | JsonMutationResult;
} & Partial<StoreMutator>): StoreMutator {
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
    prefetch: base.prefetch ?? (() => {}),
    emitDevAction: base.emitDevAction ?? (() => {}),
    cleanupPath: base.cleanupPath ?? (() => {}),
  };
}
