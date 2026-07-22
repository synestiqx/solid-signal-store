/**
 * store-solid — SolidJS port of the reactive store engine.
 * Full API parity with original, dramatically simpler reactivity layer thanks to Solid.
 *
 * See README.md for the public API, contracts, and architecture overview.
 */
export { SolidStore, createSolidStore, useSolidStore, waitForStore, onSolidDevAction } from './core/SolidStore.js';
export type { WaitForStoreOptions } from './core/SolidStore.js';
export { createSolidProxy } from './proxy/solid-proxy.js';
export type { StoreMutator, SolidProxyOptions, SolidWakeMode } from './proxy/solid-proxy.js';
export { createProjectionObservable } from './core/rx-interop.js';
export type { SolidStoreOptions } from './core/SolidStore.js';
export type { SolidStoreProxy, StoreArray, StoreLeaf, SolidStoreReactivity, SolidProxyMetrics } from './core/proxy-types.js';
export type { DevStream, DevToolsEvent, ProxyMetrics, SolidDevtoolsAdapter, StoreDevToolsAction, } from './core/devtools-contract.js';
export * as InternalPath from './internal/path.js';
