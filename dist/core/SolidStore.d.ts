/**
 * SolidStore.ts — single central orchestrator (CreateStore + SignalStore parity).
 * Wires createSolidProxy + narrow StoreMutator. Real in-memory root.
 * Jsnq bridge dispatch for mutate/pipe (future solid-pipeline-bridge).
 * Full public surface, headless/vanilla, batch(), zero logic dupe (proxy/bridge own theirs).
 * Minimal and contract-driven: proxy identity, cursor prefetch, root key-diff, devtools event shapes, GC cleanup.
 */
import { type Accessor } from 'solid-js';
import { type SolidWakeMode } from '../proxy/solid-proxy.js';
import { type JsonMutationResult } from 'jsnq/data-engine';
import { type ProjectionObservableOptions } from './rx-interop.js';
import { type DevStream, type SolidDevtoolsAdapter, type StoreDevToolsAction } from './devtools-contract.js';
import type { SolidJsnqBridge } from '../jsnq/solid-pipeline-bridge.js';
import type { SolidStoreProxy, SolidStoreReactivity } from './proxy-types.js';
/**
 * opinia5: reactive jsnq query handle. Callable for the current result, `.subscribe()` for a
 * push subscription (reuses the rx-interop projection observable), `.dispose()` to release the
 * per-query branch interest. Same `where(...)` DSL as `mutate`.
 */
export type SolidLiveQuery<T> = (() => T) & {
    subscribe(cb: (value: T) => void, options?: ProjectionObservableOptions<T>): {
        unsubscribe(): void;
        dispose(): void;
    };
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
    jsnqBridge?: SolidJsnqBridge;
    /**
     * How the jsnq bridge reacts to a mutation execution error.
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
    /** Optional development-only event stream adapter from `solidstore/devtools`. */
    devtools?: SolidDevtoolsAdapter;
    /**
     * Internal test hook: invoked with the path on every signal-update CALL. Lets contract
     * tests prove wake *work* granularity without prototype hacks. Forwarded to SolidProxyOptions.
     */
    _onSignalUpdate?: (path: string) => void;
}
type DevListener = (e: StoreDevToolsAction & {
    storeName?: string;
}) => void;
export declare function onSolidDevAction(fn: DevListener): () => void;
export interface WaitForStoreOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}
export declare class SolidStore<T extends Record<string, unknown> = Record<string, unknown>> {
    #private;
    readonly store: SolidStoreProxy<T>;
    private readonly data;
    private name;
    private readonly registryName;
    private devActive;
    private readonly opts;
    private reactivity?;
    _wakeParentsOnChange: boolean;
    private devService?;
    private destroyed;
    /** Action stream (subscribe for SET_VALUE/MUTATE/DELETE/PROXY_METRICS events). */
    get devAction$(): DevStream;
    /** Read/history stream (excludes PROXY_METRICS, parity with Angular readAction$). */
    get devReadAction$(): DevStream;
    /** Typed binding called by createSolidProxy so the store can wake proxy-owned signals. */
    bindReactivity(api: SolidStoreReactivity): void;
    constructor(initial: T, name?: string, opts?: SolidStoreOptions);
    read(path: string): unknown;
    write(path: string, value: unknown): JsonMutationResult;
    batch<T>(fn: () => T): T;
    delete(path: string): JsonMutationResult;
    prefetch(pathPrefix: string): void;
    emitDevAction(action: StoreDevToolsAction): void;
    cleanupPath(path: string): void;
    readStore(path?: string): unknown;
    setValue(path: string, value: unknown): void;
    deleteValue(path: string): void;
    private isArrayQueryMethod;
    private isArrayMutationMethod;
    arrayOp(path: string, method: string, args?: unknown[], current?: unknown): unknown;
    query(path: string, val: unknown, method: string, ...args: unknown[]): unknown;
    private getJsnqBridge;
    private requireJsnqBridge;
    mutate(path: string, ...ops: any[]): unknown;
    pipe(path: string, ...ops: any[]): any;
    /** One-shot snapshot query: runs the jsnq operators at `path`, returns matched values. */
    $query(path: string, ...ops: any[]): unknown[];
    /** One-shot snapshot query returning the first match (or null). */
    $queryOne(path: string, ...ops: any[]): unknown;
    /** Reactive query: recomputes when the queried branch changes. Callable + subscribable. */
    $liveQuery(path: string, ...ops: any[]): SolidLiveQuery<unknown[]>;
    /** Reactive single-match query (first match, reactive). */
    $liveQueryOne(path: string, ...ops: any[]): SolidLiveQuery<unknown>;
    array(path: string, ...args: any[]): any;
    select<TOut>(project: (state: SolidStoreProxy<T>) => TOut, options?: ProjectionObservableOptions<TOut>): {
        subscribe(cb: (v: TOut) => void): {
            unsubscribe: () => void;
            dispose: () => void;
        };
        readonly value: TOut;
    };
    computedOf<TOut>(project: (state: SolidStoreProxy<T>) => TOut): Accessor<TOut>;
    enableDevTools(storeName?: string, _showVisualizer?: boolean): void;
    attachDevtools(devtools: SolidDevtoolsAdapter): void;
    destroy(): void;
    /**
     * Emit a PROXY_METRICS snapshot (signals / proxies / branchSubs sizes). Parity with
     * Angular's emitProxyMetrics. Only fires when devtools is active. Throttling is the
     * caller's responsibility (matching Angular's metricsThrottleMs).
     */
    emitProxyMetrics(): void;
    returnStore(): SolidStoreProxy<T>;
    get _internalData(): T;
    /**
     * Runtime control of wake-up granularity.
     *
     * store.wakeUp('grained')     → only the exact changed path is dirtied (default, recommended)
     * store.wakeUp('container')   → also dirty parents on the path (more "container" behavior)
     * store.wakeUp('a.b.c', 'leaf') → Angular-compatible targeted branch wake for one path
     */
    setWakeMode(mode: SolidWakeMode): void;
    wakePath(path: string, mode?: SolidWakeMode): void;
    wakeUp(mode: SolidWakeMode): void;
    wakeUp(path: string, mode?: SolidWakeMode): void;
}
export declare function createSolidStore<T extends Record<string, unknown>>(initial: T, name?: string, options?: SolidStoreOptions): SolidStore<T>;
export declare function useSolidStore<T extends Record<string, unknown> = any>(name?: string): SolidStore<T>;
export declare function waitForStore<T extends Record<string, unknown> = any>(name?: string, options?: WaitForStoreOptions): Promise<SolidStore<T>>;
export default SolidStore;
export type { StoreMutator, SolidProxyOptions, SolidWakeMode } from '../proxy/solid-proxy.js';
export { createSolidProxy } from '../proxy/solid-proxy.js';
export type { SolidStoreProxy, StoreArray, StoreLeaf } from './proxy-types.js';
