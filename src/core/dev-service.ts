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

import type { StoreDevToolsAction } from './SolidStore';

export type DevToolsEvent = StoreDevToolsAction & { storeName?: string };

export interface ProxyMetrics {
  signals: number;
  proxies: number;
  branchSubs: number;
}

export interface DevStream<T = DevToolsEvent> {
  subscribe(cb: (value: T) => void): { unsubscribe(): void };
  get(): T | null;
}

class ListenerStream<T = DevToolsEvent> implements DevStream<T> {
  private listeners = new Set<(value: T) => void>();
  private lastValue: T | null = null;

  subscribe(cb: (value: T) => void): { unsubscribe(): void } {
    this.listeners.add(cb);
    return { unsubscribe: () => this.listeners.delete(cb) };
  }

  emit(value: T): void {
    this.lastValue = value;
    for (const fn of this.listeners) {
      try { fn(value); } catch { /* isolated listener */ }
    }
  }

  get(): T | null { return this.lastValue; }

  clear(): void {
    this.listeners.clear();
    this.lastValue = null;
  }
}

export class SolidDevService {
  readonly action$: DevStream = new ListenerStream();
  readonly readAction$: DevStream = new ListenerStream();

  emitAction(event: DevToolsEvent): void {
    (this.action$ as ListenerStream).emit(event);
  }

  emitRead(event: DevToolsEvent): void {
    (this.readAction$ as ListenerStream).emit(event);
  }

  /** Emit a PROXY_METRICS action (parity with Angular DevService.logProxyMetrics). */
  emitProxyMetrics(storeName: string, metrics: ProxyMetrics): void {
    const action: StoreDevToolsAction = {
      type: 'PROXY_METRICS',
      payload: {
        path: 'proxy-cache',
        signals: metrics.signals,
        proxies: metrics.proxies,
        branchSubs: metrics.branchSubs,
        cacheSize: metrics.proxies,
        cacheKeys: [],
      },
    };
    const event: DevToolsEvent = { ...action, storeName };
    // Metrics go to the action stream only (not read history), matching Angular.
    this.emitAction(event);
  }

  destroy(): void {
    (this.action$ as ListenerStream).clear();
    (this.readAction$ as ListenerStream).clear();
  }
}
