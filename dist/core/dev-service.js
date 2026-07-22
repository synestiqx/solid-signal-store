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
class ListenerStream {
    listeners = new Set();
    lastValue = null;
    hasValue = false;
    subscribe(cb) {
        this.listeners.add(cb);
        if (this.hasValue)
            cb(this.lastValue);
        return { unsubscribe: () => this.listeners.delete(cb) };
    }
    emit(value) {
        this.lastValue = value;
        this.hasValue = true;
        for (const fn of this.listeners) {
            try {
                fn(value);
            }
            catch { /* isolated listener */ }
        }
    }
    get() { return this.lastValue; }
    clear() {
        this.listeners.clear();
        this.lastValue = null;
        this.hasValue = false;
    }
}
export class SolidDevService {
    action$ = new ListenerStream();
    readAction$ = new ListenerStream();
    emitAction(event) {
        this.action$.emit(event);
    }
    emitRead(event) {
        this.readAction$.emit(event);
    }
    /** Emit a PROXY_METRICS action (parity with Angular DevService.logProxyMetrics). */
    emitProxyMetrics(storeName, metrics) {
        const action = {
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
        const event = { ...action, storeName };
        // Metrics go to the action stream only (not read history), matching Angular.
        this.emitAction(event);
    }
    destroy() {
        this.action$.clear();
        this.readAction$.clear();
    }
}
export function createSolidDevtools() {
    return new SolidDevService();
}
//# sourceMappingURL=dev-service.js.map