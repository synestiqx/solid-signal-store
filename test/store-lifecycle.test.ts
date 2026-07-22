import { createSolidStore, useSolidStore } from '../src';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const first = createSolidStore({ nested: { value: 1 } }, 'lifecycle');
void first.store.nested.value();
assert(useSolidStore('lifecycle') === first, 'created store is registered');

const second = createSolidStore({ nested: { value: 2 } }, 'lifecycle');
assert(useSolidStore('lifecycle') === second, 'replacement becomes the registered store');
first.destroy();
assert(useSolidStore('lifecycle') === second, 'stale destroy cannot unregister replacement');

second.destroy();
second.destroy();
let missing = false;
try { useSolidStore('lifecycle'); } catch { missing = true; }
assert(missing, 'destroy is idempotent and removes current registry entry');

const dynamicApi = createSolidStore({ dynamic: {} as Record<string, number> }, 'dynamic-cache');
const dynamic = dynamicApi.store.dynamic as unknown as Record<string, (() => number) | number>;
const retained: Array<() => number> = [];
for (let index = 0; index < 300; index++) {
  dynamic[`key${index}`] = index;
  retained.push(dynamic[`key${index}`] as () => number);
}
assert(retained[0]!() === 0 && retained[299]!() === 299, 'cache rollover preserves callable dynamic paths');
dynamic.key0 = 999;
assert(retained[0]!() === 999, 'externally retained proxy remains reactive after cache rollover');
assert(dynamic.key299 === retained[299], 'hot child proxy identity remains stable');
dynamicApi.destroy();

console.log('Solid store lifecycle contract passed.');
