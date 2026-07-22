/**
 * native-vs-store-bench.ts — no-DOM benchmark, Solid twin of Angular's
 * src/app/store/native-vs-store-bench.ts. Compares a native solid-js signal
 * holding an immutable root (path get/set helpers, same as the Angular
 * baseline) against SolidStore (proxy writes, setValue, array methods) on the
 * exact same scenarios: deep path sets, push+pop, middle splice, dynamic new
 * nested paths, 100 distinct deep paths, and a large-object baseline.
 *
 * Run: bun run bench:native   (alias for: bun --conditions browser test/native-vs-store-bench.ts)
 */

import { createMemo, createRoot, createSignal } from 'solid-js';
import { createSolidStore } from '../src';
import '../src/jsnq';

// Simple helpers (immutable set/get for native signals baseline)
function getByPath(obj: any, path: string): any {
  if (!obj || typeof path !== 'string') return undefined;
  return path.split('.').reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), obj);
}

function setByPathImmutable(obj: any, path: string, val: any): any {
  const parts = path.split('.');
  const last = parts.pop()!;
  let cur = obj;
  const stack: any[] = [];
  for (const key of parts) {
    stack.push({ parent: cur, key });
    cur = cur?.[key];
  }
  // reconstruct immutably
  let node = Array.isArray(cur) ? cur.slice() : { ...(cur ?? {}) };
  (node as any)[last] = val;
  for (let i = stack.length - 1; i >= 0; i--) {
    const { parent, key } = stack[i];
    const parentClone = Array.isArray(parent) ? parent.slice() : { ...(parent ?? {}) };
    (parentClone as any)[key] = node;
    node = parentClone;
  }
  return node;
}

function bench(label: string, ops: number, fn: () => void) {
  const t0 = Date.now();
  fn();
  const dt = Date.now() - t0;
  const rps = Math.round((ops / Math.max(dt, 1)) * 1000);
  console.log(`${label}: ${dt}ms, ~${rps} ops/s`);
}

const initial = {
  key: 'init',
  user: {
    profile: { name: 'John', settings: { theme: 'dark', notifications: true } },
    posts: Array.from({ length: 100 }, (_, i) => ({ title: 'Post ' + i, content: 'C' + i }))
  },
  table: Array.from({ length: 20 }, (_, i) => ({ name: 'row' + i }))
};

const large = {
  key: 'init',
  user: {
    profile: { name: 'John', settings: { theme: 'dark', notifications: true } },
    posts: Array.from({ length: 1000 }, (_, i) => ({
      title: 'Post ' + i,
      content: 'C' + i,
      comments: Array.from({ length: 5 }, (__, j) => ({ id: j, text: 'T' + j }))
    }))
  },
  table: Array.from({ length: 200 }, (_, i) => ({ name: 'row' + i }))
};

createRoot(() => {
  console.log('\n=== Native solid-js signal (immutable root) ===');
  const [root, setRoot] = createSignal<any>(initial);
  const cName = createMemo(() => getByPath(root(), 'user.profile.name'));
  const cPostsLen = createMemo(() => getByPath(root(), 'user.posts')?.length ?? 0);

  const N = 3000;
  bench(`native: ${N} deep path sets (user.profile.name)`, N, () => {
    for (let i = 0; i < N; i++) setRoot(cur => setByPathImmutable(cur, 'user.profile.name', 'k' + i));
  });

  const A = 1000;
  bench(`native: ${A} push+pop user.posts`, 2 * A, () => {
    for (let i = 0; i < A; i++) setRoot(cur => setByPathImmutable(cur, 'user.posts', [...getByPath(cur, 'user.posts'), { title: 'X' + i, content: 'Y' }]));
    for (let i = 0; i < A; i++) setRoot(cur => { const arr = getByPath(cur, 'user.posts').slice(); arr.pop(); return setByPathImmutable(cur, 'user.posts', arr); });
  });

  const S = 300;
  bench(`native: ${S} splice middle insert 1 item`, S, () => {
    for (let i = 0; i < S; i++) setRoot(cur => { const arr = getByPath(cur, 'user.posts').slice(); const mid = (arr.length / 2) | 0; arr.splice(mid, 0, { title: 'M' + i, content: 'Z' }); return setByPathImmutable(cur, 'user.posts', arr); });
  });

  const D = 300;
  bench(`native: ${D} dynamic new nested path (user.extra.l1.l2.l3)`, D, () => {
    for (let i = 0; i < D; i++) setRoot(cur => setByPathImmutable(cur, 'user.extra.l1.l2.l3', i));
  });

  // 100 distinct deep paths scenario
  const paths100 = Array.from({ length: 100 }, (_, i) => `user.profiles.p${i}.name`);
  const N100 = 5000;
  bench(`native: ${N100} sets across 100 distinct deep paths`, N100, () => {
    for (let i = 0; i < N100; i++) setRoot(cur => setByPathImmutable(cur, paths100[i % 100], 'v' + i));
  });

  console.log('native: final name', cName());
  console.log('native: final posts len', cPostsLen());

  console.log('\n=== SolidStore (signal trie + proxy) ===');
  const api = createSolidStore(JSON.parse(JSON.stringify(initial)), 'bench_native_vs_store');
  const data: any = api.store;

  bench(`store: ${N} deep path sets (user.profile.name)`, N, () => {
    for (let i = 0; i < N; i++) api.setValue('user.profile.name', 'k' + i);
  });

  bench(`store: ${A} push+pop user.posts`, 2 * A, () => {
    for (let i = 0; i < A; i++) data.user.posts.push({ title: 'X' + i, content: 'Y' });
    for (let i = 0; i < A; i++) data.user.posts.pop();
  });

  bench(`store: ${S} splice middle insert 1 item`, S, () => {
    for (let i = 0; i < S; i++) { const mid = (data.user.posts.length / 2) | 0; data.user.posts.splice(mid, 0, { title: 'M' + i, content: 'Z' }); }
  });

  bench(`store: ${D} dynamic new nested path (user.extra.l1.l2.l3)`, D, () => {
    for (let i = 0; i < D; i++) api.setValue('user.extra.l1.l2.l3', i);
  });

  bench(`store: ${N100} sets across 100 distinct deep paths`, N100, () => {
    for (let i = 0; i < N100; i++) api.setValue(paths100[i % 100], 'v' + i);
  });

  console.log('store: final name', data.user.profile.name());
  console.log('store: final posts len', data.user.posts.length);

  console.log('\n=== Large object baseline (native vs store) ===');
  // Native large
  const [rootLarge, setRootLarge] = createSignal<any>(large);
  bench('native large: 500 deep sets', 500, () => {
    for (let i = 0; i < 500; i++) setRootLarge(cur => setByPathImmutable(cur, 'user.profile.settings.theme', 't' + i));
  });
  bench('native large: 500 push+pop posts', 1000, () => {
    for (let i = 0; i < 500; i++) setRootLarge(cur => setByPathImmutable(cur, 'user.posts', [...getByPath(cur, 'user.posts'), { title: 'L' + i, content: 'Z' }]));
    for (let i = 0; i < 500; i++) setRootLarge(cur => { const arr = getByPath(cur, 'user.posts').slice(); arr.pop(); return setByPathImmutable(cur, 'user.posts', arr); });
  });

  // Store large
  const apiLarge = createSolidStore(JSON.parse(JSON.stringify(large)), 'bench_native_vs_store_large');
  const dataLarge: any = apiLarge.store;
  bench('store large: 500 deep sets', 500, () => {
    for (let i = 0; i < 500; i++) apiLarge.setValue('user.profile.settings.theme', 't' + i);
  });
  bench('store large: 500 push+pop posts', 1000, () => {
    for (let i = 0; i < 500; i++) dataLarge.user.posts.push({ title: 'L' + i, content: 'Z' });
    for (let i = 0; i < 500; i++) dataLarge.user.posts.pop();
  });

  // Dynamic path queries (find) on large data
  const cFindNative = createMemo(() => (getByPath(rootLarge(), 'user.posts') as any[]).find(p => p.title === 'Post 500'));
  const cFindStore = dataLarge.user.posts.find((p: any) => p.title === 'Post 500');
  console.log('native large find Post 500', cFindNative()?.title);
  console.log('store large find Post 500', typeof cFindStore?.title === 'function' ? cFindStore.title() : cFindStore?.title);
});
