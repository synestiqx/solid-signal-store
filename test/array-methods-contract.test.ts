import { createSolidStore } from '../src';
import { ARRAY_METHODS, ARRAY_MUTATION_METHODS, ARRAY_QUERY_METHODS } from '../src/array/solid-array';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

for (const method of ARRAY_QUERY_METHODS) {
  assert(ARRAY_METHODS.has(method), `ARRAY_METHODS should include query method ${method}`);
}
for (const method of ARRAY_MUTATION_METHODS) {
  assert(ARRAY_METHODS.has(method), `ARRAY_METHODS should include mutation method ${method}`);
}

const api = createSolidStore({ list: [1, 2, 3] }, 'solid_array_methods_contract');
const store = api.store as any;

assert(JSON.stringify(store.list.map((value: number) => value * 2)) === JSON.stringify([2, 4, 6]), 'proxy array map should dispatch as query');
assert(store.list.find((value: number) => value === 2) === 2, 'proxy array find should dispatch as query');
assert(store.list.push(4) === 4, 'proxy array push should return native length');
assert(JSON.stringify(api.readStore('list')) === JSON.stringify([1, 2, 3, 4]), 'proxy array push should commit');
assert(store.list.pop() === 4, 'proxy array pop should return removed item');
assert(JSON.stringify(api.readStore('list')) === JSON.stringify([1, 2, 3]), 'proxy array pop should commit');

console.log('All solid array method contract tests passed.');
