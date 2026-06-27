/**
 * array-splice-precise-wake.test.ts
 *
 * Contract for the opinia6 unification: Solid splice(start>0) under preciseMutationWake skips the
 * WORK of waking the untouched [0,start) prefix (mirroring Angular's computeSpliceInvalidationStart
 * at the signal level), while staying byte-for-byte CORRECT in every mode.
 *
 * Key insight proven here: precise vs generic are OBSERVABLY identical — COW (unchanged element
 * refs aliased) + Solid signal equality already prevent unchanged prefix EFFECTS from re-running in
 * BOTH paths. The precise path's win is therefore *work* (signal touches), measured via the
 * _onSignalUpdate hook, NOT a change in reactivity. So each case asserts:
 *   • correctness  — values / removed[] / length + the right effects re-run with the right values
 *   • granularity  — which signal paths were actually touched during the splice wake
 *
 *   A. grained + precise + removal   → prefix NOT touched; suffix + array touched; effects correct
 *   B. grained + precise + insertion → prefix NOT touched; suffix touched; effects correct
 *   C. container + precise           → full branch touched (prefix TOO) — proven fallback parity
 *   D. default (precise OFF)         → full branch touched (prefix TOO) + correctness
 *   E. precise + start===0           → no prefix to skip → generic path (prefix touched) + correctness
 *
 * Run: bun --conditions browser test/array-splice-precise-wake.test.ts
 */
import { createRoot, createEffect } from 'solid-js';
import { createSolidStore } from '../src';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type U = { id: number; name: string };
const makeUsers = (): U[] => [
  { id: 0, name: 'Ann' },
  { id: 1, name: 'Bob' },
  { id: 2, name: 'Cy' },
  { id: 3, name: 'Dan' },
  { id: 4, name: 'Eve' },
];

// True if any touched path is `prefix` itself or a descendant `prefix.*`.
const touchedHas = (touched: string[], prefix: string): boolean =>
  touched.some((p) => p === prefix || p.startsWith(prefix + '.'));

// A — grained + precise + removal: prefix work skipped, suffix + array touched.
async function testPreciseRemoval(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const touched: string[] = [];
        const api = createSolidStore({ users: makeUsers() } as any, 'splice_precise_rm', {
          preciseMutationWake: true,
          _onSignalUpdate: (p) => touched.push(p),
        });
        const store = api.store as any;

        const runs = [0, 0, 0, 0];
        createEffect(() => { store.users[0].name(); runs[0]++; });
        createEffect(() => { store.users[1].name(); runs[1]++; });
        createEffect(() => { store.users[2].name(); runs[2]++; });
        createEffect(() => { store.users[3].name(); runs[3]++; });
        let arrayRuns = 0;
        createEffect(() => { void (store.users() as unknown[]).length; arrayRuns++; });
        await flush();
        const base = [...runs]; const baseArr = arrayRuns;
        touched.length = 0; // measure only the splice wake

        const removed = store.users.splice(2, 1); // remove Cy(2): [Ann,Bob,Dan,Eve]
        await flush();

        // correctness
        assert(Array.isArray(removed) && removed.length === 1 && removed[0].name === 'Cy', 'A: splice returns removed[]');
        assert(store.users[0].name() === 'Ann' && store.users[1].name() === 'Bob', 'A: prefix values intact');
        assert(store.users[2].name() === 'Dan' && store.users[3].name() === 'Eve', 'A: suffix shifted left');
        assert((store.users() as unknown[]).length === 4, 'A: array length updated');
        assert(runs[0] === base[0] && runs[1] === base[1], 'A: prefix effects did not re-run (value unchanged)');
        assert(runs[2] > base[2] && runs[3] > base[3], 'A: suffix effects re-ran (values changed)');
        assert(arrayRuns > baseArr, 'A: whole-array consumer re-ran');
        // granularity (the actual unification win)
        assert(!touchedHas(touched, 'users.0'), `A: precise skipped users.0 work (touched=[${touched.join(',')}])`);
        assert(!touchedHas(touched, 'users.1'), 'A: precise skipped users.1 work');
        assert(touched.includes('users.2.name'), 'A: precise touched users.2.name');
        assert(touched.includes('users'), 'A: precise touched the array signal');

        api.destroy(); dispose(); resolve();
      } catch (e) { dispose(); reject(e); }
    });
  });
}

// B — grained + precise + insertion: prefix work skipped, suffix touched.
async function testPreciseInsertion(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const touched: string[] = [];
        const api = createSolidStore({ users: makeUsers() } as any, 'splice_precise_ins', {
          preciseMutationWake: true,
          _onSignalUpdate: (p) => touched.push(p),
        });
        const store = api.store as any;

        const runs = [0, 0, 0, 0];
        createEffect(() => { store.users[0].name(); runs[0]++; });
        createEffect(() => { store.users[1].name(); runs[1]++; });
        createEffect(() => { store.users[2].name(); runs[2]++; });
        createEffect(() => { store.users[3].name(); runs[3]++; });
        await flush();
        const base = [...runs];
        touched.length = 0;

        const removed = store.users.splice(2, 0, { id: 99, name: 'NEW' }); // [Ann,Bob,NEW,Cy,Dan,Eve]
        await flush();

        assert(Array.isArray(removed) && removed.length === 0, 'B: pure insert removes nothing');
        assert(store.users[2].name() === 'NEW' && store.users[3].name() === 'Cy', 'B: inserted + shifted values');
        assert((store.users() as unknown[]).length === 6, 'B: array length grew');
        assert(runs[0] === base[0] && runs[1] === base[1], 'B: prefix effects did not re-run');
        assert(runs[2] > base[2] && runs[3] > base[3], 'B: suffix effects re-ran');
        assert(!touchedHas(touched, 'users.0') && !touchedHas(touched, 'users.1'), `B: precise skipped prefix work (touched=[${touched.join(',')}])`);
        assert(touched.includes('users.2.name'), 'B: precise touched users.2.name');

        api.destroy(); dispose(); resolve();
      } catch (e) { dispose(); reject(e); }
    });
  });
}

// C — container + precise: must fall back to FULL branch wake (prefix touched too). Parity.
async function testContainerFallback(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const touched: string[] = [];
        const api = createSolidStore({ users: makeUsers() } as any, 'splice_container', {
          preciseMutationWake: true,
          _onSignalUpdate: (p) => touched.push(p),
        });
        api.wakeUp('container');
        const store = api.store as any;

        createEffect(() => { store.users[0].name(); });
        createEffect(() => { store.users[3].name(); });
        await flush();
        touched.length = 0;

        store.users.splice(2, 1);
        await flush();

        assert(store.users[2].name() === 'Dan', 'C: value correct in container mode');
        assert(touchedHas(touched, 'users.0'), `C: container falls back to full branch — prefix touched (touched=[${touched.join(',')}])`);
        assert(touchedHas(touched, 'users.3'), 'C: container touches the suffix');

        api.destroy(); dispose(); resolve();
      } catch (e) { dispose(); reject(e); }
    });
  });
}

// D — default (precise OFF): proven full branch wake (prefix touched) + correctness.
async function testDefaultCorrectness(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const touched: string[] = [];
        const api = createSolidStore({ users: makeUsers() } as any, 'splice_default', {
          _onSignalUpdate: (p) => touched.push(p),
        }); // no preciseMutationWake
        const store = api.store as any;

        createEffect(() => { store.users[0].name(); });
        await flush();
        touched.length = 0;

        const removed = store.users.splice(1, 2, { id: 88, name: 'X' }); // [Ann,X,Dan,Eve]
        await flush();

        assert(removed.length === 2 && removed[0].name === 'Bob' && removed[1].name === 'Cy', 'D: removed Bob,Cy');
        assert(store.users[1].name() === 'X' && store.users[2].name() === 'Dan', 'D: values correct');
        assert((store.users() as unknown[]).length === 4, 'D: length correct');
        assert(touchedHas(touched, 'users.0'), `D: default full branch wake touches prefix (touched=[${touched.join(',')}])`);

        api.destroy(); dispose(); resolve();
      } catch (e) { dispose(); reject(e); }
    });
  });
}

// E — precise + start===0: no prefix to skip → generic path (prefix touched) + correctness.
async function testPreciseStartZero(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const touched: string[] = [];
        const api = createSolidStore({ users: makeUsers() } as any, 'splice_start0', {
          preciseMutationWake: true,
          _onSignalUpdate: (p) => touched.push(p),
        });
        const store = api.store as any;

        let r0 = 0; let v0: unknown;
        createEffect(() => { v0 = store.users[0].name(); r0++; });
        await flush();
        const base0 = r0;
        touched.length = 0;

        const removed = store.users.splice(0, 1); // remove Ann: [Bob,Cy,Dan,Eve]
        await flush();

        assert(removed.length === 1 && removed[0].name === 'Ann', 'E: removed head');
        assert(store.users[0].name() === 'Bob', 'E: head shifted');
        assert(r0 > base0 && v0 === 'Bob', 'E: index 0 effect re-ran with new value');
        assert(touchedHas(touched, 'users.0'), 'E: start=0 → generic path touches index 0');

        api.destroy(); dispose(); resolve();
      } catch (e) { dispose(); reject(e); }
    });
  });
}

await testPreciseRemoval();
await testPreciseInsertion();
await testContainerFallback();
await testDefaultCorrectness();
await testPreciseStartZero();

console.log('All solid splice precise-wake tests passed.');
