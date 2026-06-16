import { createRoot } from 'solid-js';
import { createSolidStore } from '../src';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const scenario = createRoot((dispose) => {
  const api = createSolidStore({
    user: {
      name: 'Ada',
      stats: { count: 0 },
    },
  }, 'solid_select_observable');
  const store = api.store as any;
  const values: string[] = [];
  const observable = api.select((state: any) => `${state.user.name()}#${state.user.stats.count()}`);
  const subscription = observable.subscribe((value) => values.push(value));
  return { api, store, values, observable, subscription, dispose };
});

assert(scenario.values.length === 1, `select: expected immediate value, got ${scenario.values.length}`);
assert(scenario.values[0] === 'Ada#0', `select: initial value ${scenario.values[0]}`);
assert(scenario.observable.value === 'Ada#0', 'select: value getter initial');

scenario.store.user.stats.count = 1;
await flush();
assert(scenario.values.at(-1) === 'Ada#1', `select: proxy mutation emitted ${scenario.values.join(',')}`);
assert(scenario.observable.value === 'Ada#1', 'select: value getter after proxy mutation');

scenario.api.setValue('user.name', 'Grace');
await flush();
assert(scenario.values.at(-1) === 'Grace#1', `select: setValue emitted ${scenario.values.join(',')}`);

const projectedValues: Array<{ count: number; name: string }> = [];
const projected = scenario.api.select(
  (state: any) => ({ count: state.user.stats.count(), name: state.user.name() }),
  {
    immediate: false,
    equals: (a, b) => a.count === b.count,
  }
);
const projectedSubscription = projected.subscribe((value) => projectedValues.push(value));
await flush();
assert(projectedValues.length === 0, `select: immediate false should skip initial emission, got ${projectedValues.length}`);

scenario.store.user.name = 'Ignored By Equals';
await flush();
assert(projectedValues.length === 0, 'select: custom equals should suppress same-count projection');

scenario.store.user.stats.count = 2;
await flush();
assert(projectedValues.length === 1, `select: custom equals should emit count change, got ${projectedValues.length}`);
assert(projectedValues[0].count === 2, `select: projected count ${projectedValues[0].count}`);
projectedSubscription.dispose();

let capturedError: unknown;
const errorObservable = scenario.api.select((state: any) => state.user.name(), {
  onError: (error) => { capturedError = error; },
});
const errorSubscription = errorObservable.subscribe(() => {
  throw new Error('subscriber boom');
});
await flush();
assert(capturedError instanceof Error && capturedError.message === 'subscriber boom', 'select: onError captures subscriber errors');
errorSubscription.unsubscribe();

const beforeUnsubscribe = scenario.values.length;
scenario.subscription.unsubscribe();
scenario.store.user.stats.count = 3;
await flush();
assert(scenario.values.length === beforeUnsubscribe, 'select: unsubscribe stops emissions');

scenario.dispose();
console.log('All solid select observable reactivity tests passed.');
