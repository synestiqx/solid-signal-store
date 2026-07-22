import { createSolidStore } from '../src/core/SolidStore';
import {
  clearPathCaches,
  enumerateAncestors,
  getByPath,
  isValidPath,
  pathExists,
  resolveVersionPath,
  setByPath,
  splitPath,
} from '../src/internal/path';
import { PathUtils as JsonPathUtils } from '../src/jsnq/utils/path-utils';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertThrows(run: () => void, message: string): void {
  let threw = false;
  try {
    run();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

clearPathCaches();

const source = { a: { b: [{ c: 42 }] }, root: { 'complex.key': { items: [{ label: 'x' }] } } };
assert(getByPath(source, 'a.b[0].c') === 42, 'Solid internal path should read bracket numeric paths');
assert(JSON.stringify(splitPath('a.b[0].c')) === JSON.stringify(['a', 'b', '0', 'c']), 'Solid internal path should normalize and split bracket numeric paths');

const target: any = {};
setByPath(target, 'items[0].name', 'first');
assert(Array.isArray(target.items), 'Solid setByPath should create arrays for numeric segments');
assert(target.items[0].name === 'first', 'Solid setByPath should write into numeric array segments');

const replacePrimitive: any = { a: 1 };
setByPath(replacePrimitive, 'a.b.c', 3);
assert(replacePrimitive.a.b.c === 3, 'setByPath should replace primitive intermediates with object branches');

const undefinedTarget: any = { a: { b: undefined } };
assert(pathExists(undefinedTarget, 'a.b'), 'pathExists should distinguish present undefined from missing path');
assert(!pathExists(undefinedTarget, 'a.c'), 'pathExists should reject missing keys');
assert(getByPath({ a: null } as any, 'a.b.c') === undefined, 'getByPath should stop on null intermediates');

for (const forbidden of ['__proto__', 'prototype', 'constructor']) {
  const unsafePath = `safe.${forbidden}.polluted`;
  assert(getByPath({ safe: { [forbidden]: { polluted: true } } } as any, unsafePath) === undefined, `${forbidden} should not be read`);
  assert(!pathExists({ safe: { [forbidden]: { polluted: true } } } as any, unsafePath), `${forbidden} should not exist through pathExists`);
  assert(!isValidPath(unsafePath), `${forbidden} should invalidate paths`);
  assertThrows(() => setByPath({ safe: {} } as any, unsafePath, true), `${forbidden} should not be written`);
}
assert(({} as Record<string, unknown>)['polluted'] === undefined, 'forbidden writes should not pollute Object prototype');

assert(
  JSON.stringify(JsonPathUtils.splitPathExpression('root["complex.key"].items[2].label')) === JSON.stringify(['root', 'complex.key', 'items', '2', 'label']),
  'splitPathExpression should preserve quoted dotted keys'
);
assert(
  JSON.stringify(JsonPathUtils.splitPathExpression('root.field\\.with\\.dots[0]')) === JSON.stringify(['root', 'field.with.dots', '0']),
  'splitPathExpression should preserve escaped dots'
);
assert(
  JSON.stringify(JsonPathUtils.splitPathExpression('root["quote\\\"key"].items[0]')) === JSON.stringify(['root', 'quote"key', 'items', '0']),
  'splitPathExpression should preserve escaped quotes'
);

assert(
  JSON.stringify(enumerateAncestors('tree[0].fields[0].data', { includeNumericParent: true })) ===
    JSON.stringify(['tree.0.fields.0.data', 'tree.0.fields.0', 'tree.0.fields', 'tree.0', 'tree']),
  'enumerateAncestors should use normalized numeric path segments'
);
assert(
  JSON.stringify(enumerateAncestors('safe.__proto__.x', { includeNumericParent: true })) === JSON.stringify([]),
  'enumerateAncestors should reject forbidden paths'
);
assert(
  resolveVersionPath('tree.0.fields.0.data', { dependencyMode: 'container', bumpNumericParent: true }) === 'tree',
  'resolveVersionPath should collapse numeric containers when requested'
);

const strict = createSolidStore({ nested: { value: 1 } }, 'solid_strict_path_core_parity', { strict: { invalidPath: true } });
assertThrows(() => {
  (strict.store as any)['bad..path'] = 1;
}, 'Solid strict invalidPath should reject direct proxy writes');
assertThrows(() => {
  delete (strict.store as any)['bad..path'];
}, 'Solid strict invalidPath should reject direct proxy deletes');
strict.destroy();

console.log('path-core-parity: Solid local path core behavior -> OK');
