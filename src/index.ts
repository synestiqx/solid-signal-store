/**
 * store-solid — SolidJS port of the reactive store engine.
 * Full API parity with original, dramatically simpler reactivity layer thanks to Solid.
 * 
 * See PLAN.md v2 (post-Critic) for architecture, contracts, and "do samego końca" rules.
 */

// Core
export { SolidStore, createSolidStore, useSolidStore, onSolidDevAction } from './core/SolidStore';

// Proxy (for advanced wiring / testing)
export { createSolidProxy } from './proxy/solid-proxy';
export type { StoreMutator, SolidProxyOptions, SolidWakeMode } from './proxy/solid-proxy';

// Rx interop (minimal for .select parity)
export { createProjectionObservable } from './core/rx-interop';

// Re-export key types for convenience
export type { SolidStoreOptions, StoreDevToolsAction } from './core/SolidStore';
export type { SolidStoreProxy, StoreArray, StoreLeaf, SolidStoreReactivity, SolidProxyMetrics } from './core/proxy-types';

// Devtools stream service (parity with Angular DevService)
export { SolidDevService } from './core/dev-service';
export type { DevStream, DevToolsEvent, ProxyMetrics } from './core/dev-service';

// Internal utilities (for advanced use / future extensions)
export * as InternalPath from './internal/path';
