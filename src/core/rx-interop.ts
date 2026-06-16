import { createEffect, createRoot } from 'solid-js';

const INITIAL = Symbol('initial');

export type ProjectionObservableOptions<T> = {
  equals?: (a: T, b: T) => boolean;
  immediate?: boolean;
  onError?: (error: unknown) => void;
};

export function createProjectionObservable<T>(
  accessor: () => T,
  options: ProjectionObservableOptions<T> = {}
) {
  const equals = options.equals ?? Object.is;
  const immediate = options.immediate ?? true;
  const reportError = (error: unknown) => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    queueMicrotask(() => { throw error; });
  };

  return {
    subscribe(cb: (v: T) => void) {
      let last: T | typeof INITIAL = INITIAL;
      let initialized = false;

      const emit = (value: T) => {
        if (last !== INITIAL && equals(last, value)) return;
        last = value;

        if (!immediate && !initialized) {
          initialized = true;
          return;
        }

        initialized = true;
        try { cb(value); } catch (error) { reportError(error); }
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
