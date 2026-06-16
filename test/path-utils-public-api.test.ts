import { PathUtils } from '../src/utils/path-utils';
import { clearPathCaches } from '../src/internal/path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function same(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message}: expected ${e}, got ${a}`);
}

clearPathCaches();

const source: any = {
  a: { b: [{ c: 1 }], undef: undefined },
  nested: { leaf: { value: 2 } },
};
const writeTarget: any = {};
PathUtils.setByPath(writeTarget, 'items[0].name', 'first');

const snapshot = {
  normalize: PathUtils.normalizePath('a.b[0].c'),
  splitNormalized: PathUtils.splitNormalizedPath('a.b.0.c'),
  getEmptyCompat: PathUtils.getByPath(source, ''),
  getBracket: PathUtils.getByPath(source, 'a.b[0].c'),
  getMissing: PathUtils.getByPath(source, 'a.b[9].c'),
  getForbidden: PathUtils.getByPath({ safe: { __proto__: { x: 1 } } } as any, 'safe.__proto__.x'),
  setArrayShape: writeTarget,
  valid: [PathUtils.isValidPath('a.b[0].c'), PathUtils.isValidPath('safe.__proto__.x'), PathUtils.isValidPath('bad..path')],
  existsUndefined: PathUtils.pathExists(source, 'a.undef'),
  existsMissing: PathUtils.pathExists(source, 'a.missing'),
  parent: PathUtils.getParentPath('a.b[0].c'),
  versionExact: PathUtils.resolveVersionPath('tree.0.fields.1.data', { dependencyMode: 'exact', bumpNumericParent: true }),
  versionContainer: PathUtils.resolveVersionPath('tree.0.fields.1.data', { dependencyMode: 'container', bumpNumericParent: true }),
  ancestors: PathUtils.enumerateAncestors('tree[0].fields[1].data', { includeNumericParent: true }),
};

same(snapshot, {
  normalize: 'a.b.0.c',
  splitNormalized: ['a', 'b', '0', 'c'],
  getEmptyCompat: undefined,
  getBracket: 1,
  getMissing: undefined,
  getForbidden: undefined,
  setArrayShape: { items: [{ name: 'first' }] },
  valid: [true, false, false],
  existsUndefined: true,
  existsMissing: false,
  parent: 'a.b.0',
  versionExact: 'tree',
  versionContainer: 'tree',
  ancestors: ['tree.0.fields.1.data', 'tree.0.fields.1', 'tree.0.fields', 'tree.0', 'tree'],
}, 'Solid PathUtils public API snapshot should stay stable');

console.log('path-utils-public-api: Solid PathUtils public API -> OK');
