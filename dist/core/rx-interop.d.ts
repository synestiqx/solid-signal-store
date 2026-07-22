export type ProjectionObservableOptions<T> = {
    equals?: (a: T, b: T) => boolean;
    immediate?: boolean;
    onError?: (error: unknown) => void;
};
export declare function createProjectionObservable<T>(accessor: () => T, options?: ProjectionObservableOptions<T>): {
    subscribe(cb: (v: T) => void): {
        unsubscribe: () => void;
        dispose: () => void;
    };
    readonly value: T;
};
