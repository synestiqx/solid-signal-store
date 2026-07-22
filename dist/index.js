/**
 * store-solid — SolidJS port of the reactive store engine.
 * Full API parity with original, dramatically simpler reactivity layer thanks to Solid.
 *
 * See README.md for the public API, contracts, and architecture overview.
 */
// Core
export { SolidStore, createSolidStore, useSolidStore, waitForStore, onSolidDevAction } from './core/SolidStore.js';
// Proxy (for advanced wiring / testing)
export { createSolidProxy } from './proxy/solid-proxy.js';
// Rx interop (minimal for .select parity)
export { createProjectionObservable } from './core/rx-interop.js';
// Internal utilities (for advanced use / future extensions)
export * as InternalPath from './internal/path.js';
//# sourceMappingURL=index.js.map