export type StoreDevToolsAction = {
    type: string;
    payload?: Record<string, unknown>;
    storeName?: string;
};
export type DevToolsEvent = StoreDevToolsAction & {
    storeName?: string;
};
export interface ProxyMetrics {
    signals: number;
    proxies: number;
    branchSubs: number;
}
export interface DevStream<T = DevToolsEvent> {
    subscribe(cb: (value: T) => void): {
        unsubscribe(): void;
    };
    get(): T | null;
}
export interface SolidDevtoolsAdapter {
    readonly action$: DevStream;
    readonly readAction$: DevStream;
    emitAction(event: DevToolsEvent): void;
    emitRead(event: DevToolsEvent): void;
    emitProxyMetrics(storeName: string, metrics: ProxyMetrics): void;
    destroy(): void;
}
export declare const EMPTY_DEV_STREAM: DevStream;
