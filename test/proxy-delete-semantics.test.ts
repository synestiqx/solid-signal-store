import { createSolidStore } from '../src';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const api = createSolidStore(
  { node: { data: 'before', child: { label: 'old' } }, list: ['a', 'b', 'c'] } as any,
  'solid_proxy_delete_semantics'
);
const store: any = api.store;
const node = store.node;
const child = store.node.child;

node.data = undefined;
assert(!Object.prototype.hasOwnProperty.call(api.readStore('node') as any, 'data'), 'proxy set undefined should delete object key');

node.data = 'restored';
assert(store.node.data() === 'restored', 'proxy should restore deleted object key');

delete node.data;
assert(!Object.prototype.hasOwnProperty.call(api.readStore('node') as any, 'data'), 'proxy delete should delete object key');

store.node = { data: 'branch-replaced', child: { label: 'new-child' } };
assert(node.data() === 'branch-replaced', 'held parent proxy should follow live path after branch replacement');
assert(child.label() === 'new-child', 'held child proxy should follow live path after branch replacement');

store.list[1] = undefined;
assert(JSON.stringify(api.readStore('list')) === JSON.stringify(['a', 'c']), 'proxy set undefined should splice array index');

console.log('solid-proxy-delete-semantics: set undefined/delete parity -> OK');
