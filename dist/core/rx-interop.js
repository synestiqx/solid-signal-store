import { createEffect, createRoot } from 'solid-js';
const INITIAL = Symbol('initial');
export function createProjectionObservable(accessor, options = {}) {
    const equals = options.equals ?? Object.is;
    const immediate = options.immediate ?? true;
    const reportError = (error) => {
        if (options.onError) {
            options.onError(error);
            return;
        }
        queueMicrotask(() => { throw error; });
    };
    return {
        subscribe(cb) {
            let last = INITIAL;
            let initialized = false;
            const emit = (value) => {
                if (last !== INITIAL && equals(last, value))
                    return;
                last = value;
                if (!immediate && !initialized) {
                    initialized = true;
                    return;
                }
                initialized = true;
                try {
                    cb(value);
                }
                catch (error) {
                    reportError(error);
                }
            };
            const dispose = createRoot((dispose) => {
                createEffect(() => emit(accessor()));
                return dispose;
            });
            return { unsubscribe: dispose, dispose };
        },
        get value() { return accessor(); },
    };
}
//# sourceMappingURL=rx-interop.js.map