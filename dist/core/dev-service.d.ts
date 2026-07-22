/**
 * SolidDevService — per-store devtools stream layer, parity with Angular's DevService.
 *
 * Angular's DevService exposes `action$` / `readAction$` BehaviorSubject streams plus
 * proxy-cache metrics helpers. Solid does not use RxJS, so these streams are minimal
 * listener-set subjects (subscribe(cb) → unsubscribe, plus a last-value cache mirroring
 * BehaviorSubject's "current value" contract). The legacy global `onSolidDevAction` bus
 * (SolidStore.ts) is kept for back-compat; this service is the typed per-instance layer
 * that the Angular host already had and Solid was missing.
 */
import type { DevStream, DevToolsEvent, ProxyMetrics, SolidDevtoolsAdapter } from './devtools-contract.js';
export type { DevStream, DevToolsEvent, ProxyMetrics, SolidDevtoolsAdapter } from './devtools-contract.js';
export declare class SolidDevService implements SolidDevtoolsAdapter {
    readonly action$: DevStream;
    readonly readAction$: DevStream;
    emitAction(event: DevToolsEvent): void;
    emitRead(event: DevToolsEvent): void;
    /** Emit a PROXY_METRICS action (parity with Angular DevService.logProxyMetrics). */
    emitProxyMetrics(storeName: string, metrics: ProxyMetrics): void;
    destroy(): void;
}
export declare function createSolidDevtools(): SolidDevService;
