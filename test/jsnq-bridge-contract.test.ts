/**
 * jsnq-bridge-contract.test.ts
 *
 * Contract net for the Solid jsnq bridge + store mutate surface, written BEFORE
 * the precise-wake / mutation-metadata work so any later refactor is proven to
 * preserve today's observable behaviour and public API.
 *
 * Two layers:
 *  1. Bridge value semantics — applyPipelineMutation(ops, value, { path }) for the
 *     whole operator family (update/replace/merge/deleteKey/deleteElement/
 *     move/copy/insert/insertTo/deep-@/moveToMatches/copyToAll), plus the COW
 *     identity contract (matched items cloned, unmatched aliased, input never
 *     mutated) that the fast paths depend on.
 *  2. Store mutate end-to-end — $mutate commits correctly, fine-grained leaf
 *     consumers wake, and $liveQuery recomputes. These are the invariants that
 *     MUST hold regardless of how granular the wake becomes.
 *
 * Run: bun --conditions browser test/jsnq-bridge-contract.test.ts
 */
import { createRoot, createEffect } from 'solid-js';
import { applyPipelineMutation } from '../src/jsnq/solid-pipeline-bridge';
import { createSolidStore } from '../src';
import '../src/jsnq'; // global bridge registration for $mutate / $liveQuery
import where from '@adsq/jsnq/operators/where';
import update from '@adsq/jsnq/operators/update';
import replace from '@adsq/jsnq/operators/replace';
import mergeUpdate from '@adsq/jsnq/operators/mergeUpdate';
import deleteKey from '@adsq/jsnq/operators/deleteKey';
import deleteElement from '@adsq/jsnq/operators/deleteElement';
import insert from '@adsq/jsnq/operators/insert';
import insertTo from '@adsq/jsnq/operators/insertTo';
import moveTo from '@adsq/jsnq/operators/moveTo';
import copyTo from '@adsq/jsnq/operators/copyTo';
import moveToMatches from '@adsq/jsnq/operators/moveToMatches';
import copyToAll from '@adsq/jsnq/operators/copyToAll';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type User = { id: number; active: boolean; name: string; score?: number; meta?: Record<string, unknown> };

const flatUsers = (): User[] => [
  { id: 1, active: true, name: 'Ann', score: 10, meta: { group: 1 } },
  { id: 2, active: false, name: 'Bob', score: 20, meta: { group: 2 } },
  { id: 3, active: true, name: 'Cy', score: 30, meta: { group: 3 } },
];

// --- 1. Flat fast-path: where + update, with the COW identity contract ---
function testFlatUpdateCow(): void {
  const input = flatUsers();
  const out = applyPipelineMutation([where('active', '===', true), update('score', 99)], input, { path: 'users' }) as User[];

  assert(Array.isArray(out) && out.length === 3, 'flat update returns same-length array');
  assert(out[0].score === 99 && out[2].score === 99, 'matched items updated');
  assert(out[1].score === 20, 'unmatched item untouched in output');

  // COW identity contract the precise-wake step relies on:
  assert(input[0].score === 10, 'input matched item NOT mutated (COW clone)');
  assert(out[1] === input[1], 'unmatched item aliased by reference (no needless clone)');
  assert(out !== input, 'output is a fresh outer array');
}

function testMissingBridgeFailsExplicitly(): void {
  const globals = globalThis as any;
  const savedInternal = globals.__SOLID_PIPELINE_BRIDGE;
  const savedPublic = globals.solidJsnqBridge;
  delete globals.__SOLID_PIPELINE_BRIDGE;
  delete globals.solidJsnqBridge;
  try {
    const api = createSolidStore({ users: flatUsers() } as any, 'contract_missing_bridge');
    let threw = false;
    try { api.store.users.$mutate(where('id', '===', 1), update('name', 'Ada')); }
    catch (error) { threw = String(error).includes("Import '@adsq/solid-signal-store/jsnq'"); }
    assert(threw, 'missing optional bridge throws an actionable error');
    api.destroy();
  } finally {
    globals.__SOLID_PIPELINE_BRIDGE = savedInternal;
    globals.solidJsnqBridge = savedPublic;
  }
}

// --- 2. mergeUpdate + deleteKey on the same matched set ---
function testMergeAndDeleteKey(): void {
  const input = flatUsers();
  const out = applyPipelineMutation(
    [where('active', '===', false), mergeUpdate('meta', { checked: true }), deleteKey('name')],
    input,
    { path: 'users' }
  ) as User[];
  assert((out[1].meta as any).checked === true, 'mergeUpdate merged into matched item');
  assert((out[1].meta as any).group === 2, 'mergeUpdate preserved existing keys');
  assert(!('name' in out[1]), 'deleteKey removed key on matched item');
  assert('name' in out[0] && out[0].name === 'Ann', 'unmatched item keeps its key');
}

// --- 3. update by key on a matched object (non-fast, value action) ---
function testUpdateByKey(): void {
  const input = flatUsers();
  const out = applyPipelineMutation([where('id', '===', 2), update('name', 'Renamed')], input, { path: 'users' }) as User[];
  assert(out[1].name === 'Renamed', 'update sets matched key');
  assert(out[0].name === 'Ann' && out[2].name === 'Cy', 'update leaves others alone');
}

// --- 4. move (structural, atomic) via moveToMatches ---
function testMoveMatches(): void {
  const input = {
    sections: [
      { id: 's0', fields: [{ id: 'f0-0' }, { id: 'f0-1' }] },
      { id: 's3', fields: [] as Array<{ id: string }> },
    ],
  };
  const out = applyPipelineMutation([where('id', '===', 'f0-0'), moveToMatches('id', '===', 's3')], input, { path: '' }) as any;
  assert(!out.sections[0].fields.some((f: any) => f.id === 'f0-0'), 'moved field removed from source');
  // inside-insert into an OBJECT target with no key uses the element's id as the key (locked contract).
  assert(out.sections[1]['f0-0'] && out.sections[1]['f0-0'].id === 'f0-0', 'moved field placed into object target under its id key');
}

// --- 5. moveTo a concrete path ---
function testMoveToPath(): void {
  const input = { items: [{ id: 1 }, { id: 2 }], archive: { list: [] as Array<{ id: number }> } };
  const out = applyPipelineMutation([where('id', '===', 1), moveTo('archive.list', 'inside')], input, { path: '' }) as typeof input;
  assert(out.items.length === 1 && out.items[0].id === 2, 'moveTo removed from source array');
  assert(out.archive.list.length === 1 && out.archive.list[0].id === 1, 'moveTo inserted into target path');
}

// --- 6. copy / copyToAll keeps source, clones into targets ---
function testCopyToAll(): void {
  const input = {
    nodes: [
      { id: 'a', type: 'group', children: [] as unknown[] },
      { id: 'b', type: 'group', children: [] as unknown[] },
      { id: 'leaf', type: 'item' },
    ],
  };
  const out = applyPipelineMutation([where('id', '===', 'leaf'), copyToAll('type', '===', 'group', 'inside', 'copied')], input, { path: '' }) as typeof input;
  assert(out.nodes.some((n) => n.id === 'leaf'), 'copy keeps the source');
  assert(JSON.stringify(out).includes('"copied"'), 'copyToAll wrote copies into group targets');
}

// --- 7. copyTo single path ---
function testCopyToPath(): void {
  const input = { items: [{ id: 1, name: 'one' }], shelf: {} as Record<string, unknown> };
  const out = applyPipelineMutation([where('id', '===', 1), copyTo('shelf', 'inside', 'saved')], input, { path: '' }) as typeof input;
  assert(out.items.length === 1, 'copyTo keeps source element');
  assert((out.shelf as any).saved && (out.shelf as any).saved.id === 1, 'copyTo placed a copy at target key');
}

// --- 8. insert relative + insertTo path ---
function testInserts(): void {
  const input = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const afterRel = applyPipelineMutation([where('id', '===', 2), insert({ id: 99 }, 'after')], input, { path: 'list' }) as Array<{ id: number }>;
  assert(afterRel[2].id === 99, 'insert after placed element right after the match');

  const tree = { box: { items: [] as unknown[] } };
  const afterPath = applyPipelineMutation([insertTo('box.items', { fresh: true }, 'inside')], tree, { path: '' }) as typeof tree;
  assert((afterPath.box.items[0] as any).fresh === true, 'insertTo created element at target path');
}

// --- 9. deleteElement removes the matched element ---
function testDeleteElement(): void {
  const input = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const out = applyPipelineMutation([where('id', '===', 2), deleteElement()], input, { path: 'list' }) as Array<{ id: number }>;
  assert(out.length === 2 && !out.some((x) => x.id === 2), 'deleteElement removed only the matched element');
}

// --- 10. deep `@` update reaches nested array members ---
function testDeepUpdate(): void {
  const input = {
    sections: [
      { id: 's0', fields: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    ],
  };
  const out = applyPipelineMutation([where('fields@id', '===', 'b'), update('label', 'Renamed')], input, { path: '' }) as typeof input;
  assert(out.sections[0].fields[1].label === 'Renamed', 'deep @ update reached nested member');
  assert(out.sections[0].fields[0].label === 'A', 'deep @ update left siblings alone');
}

// --- 10b. bridgeErrorMode: default preserved, 'silent' quiet, 'throw' surfaces ---
function testBridgeErrorMode(): void {
  const badOp = (() => { throw new Error('boom'); }) as any; // reaches the fallback catch
  const value = [{ id: 1 }];

  // 'throw' surfaces the real error instead of a swallowed no-op
  let threw = false;
  try { applyPipelineMutation([badOp], value, { path: 'x', bridgeErrorMode: 'throw' }); }
  catch { threw = true; }
  assert(threw, "bridgeErrorMode 'throw' rethrows execution errors");

  const origWarn = console.warn;
  const origError = console.error;
  let logs = 0;
  console.warn = (() => { logs++; }) as any;
  console.error = (() => { logs++; }) as any;
  try {
    // 'silent' returns a safe clone with no console output
    const outSilent = applyPipelineMutation([badOp], value, { path: 'x', bridgeErrorMode: 'silent' });
    assert(Array.isArray(outSilent) && outSilent !== value, "bridgeErrorMode 'silent' returns a safe clone");
    assert(logs === 0, "bridgeErrorMode 'silent' does not log");

    // default (undefined) preserves the historical warn + safe-clone + no-throw behaviour
    logs = 0;
    const outDefault = applyPipelineMutation([badOp], value, { path: 'x' });
    assert(Array.isArray(outDefault) && outDefault !== value, 'default error mode returns a safe clone (no throw)');
    assert(logs >= 1, 'default error mode logs (historical behaviour preserved)');
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
}

// --- 11. Store end-to-end: $mutate commits + fine-grained leaf consumer wakes ---
async function testStoreMutateReactivity(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const api = createSolidStore({ users: flatUsers() } as any, 'contract_mutate');
        const store = api.store as any;

        let leafRuns = 0;
        let leafValue: unknown;
        createEffect(() => { leafValue = store.users[0].name(); leafRuns++; });
        await flush();
        assert(leafRuns === 1 && leafValue === 'Ann', `leaf effect initial (runs=${leafRuns}, val=${String(leafValue)})`);

        store.users.$mutate(where('id', '===', 1), update('name', 'Ada'));
        await flush();

        // Commit correctness (both proxy read and readStore must agree):
        assert(store.users[0].name() === 'Ada', 'proxy read reflects $mutate');
        assert((api.readStore('users') as User[])[0].name === 'Ada', 'readStore reflects $mutate');
        assert((api.readStore('users') as User[])[1].name === 'Bob', '$mutate left other items intact');
        // Invariant that must hold under any wake granularity: the changed leaf re-ran.
        assert(leafRuns >= 2 && leafValue === 'Ada', `changed-leaf consumer woke (runs=${leafRuns}, val=${String(leafValue)})`);

        api.destroy();
        dispose();
        resolve();
      } catch (error) {
        dispose();
        reject(error);
      }
    });
  });
}

// --- 12. Store end-to-end: $liveQuery recomputes after $mutate ---
function testLiveQueryAfterMutate(): void {
  createRoot((dispose) => {
    const api = createSolidStore({ users: flatUsers() } as any, 'contract_live');
    api.wakeUp('grained');
    const store = api.store as any;

    const q = store.users.$liveQuery(where('active', '===', true));
    assert((q() as User[]).length === 2, 'liveQuery initial count');

    store.users.$mutate(where('id', '===', 1), update('active', false));
    assert((q() as User[]).length === 1, `liveQuery recomputes after $mutate (got ${(q() as User[]).length})`);
    assert((q() as User[])[0].id === 3, 'liveQuery result correct after $mutate');

    q.dispose();
    api.destroy();
    dispose();
  });
}

testFlatUpdateCow();
testMissingBridgeFailsExplicitly();
testMergeAndDeleteKey();
testUpdateByKey();
testMoveMatches();
testMoveToPath();
testCopyToAll();
testCopyToPath();
testInserts();
testDeleteElement();
// --- 13. preciseMutationWake (opt-in): unchanged siblings stay asleep; changed leaf,
//         whole-array consumer and $liveQuery still wake (load-independent proof) ---
async function testPreciseMutationWake(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const api = createSolidStore({ users: flatUsers() } as any, 'contract_precise', { preciseMutationWake: true });
        const store = api.store as any;

        let changedRuns = 0; let changedVal: unknown;
        let unchangedRuns = 0;
        let arrayRuns = 0;
        let itemRuns = 0;
        let untouchedNestedRuns = 0;
        createEffect(() => { changedVal = store.users[0].name(); changedRuns++; });
        createEffect(() => { store.users[2].name(); unchangedRuns++; });
        createEffect(() => { const a = store.users() as unknown[]; void a.length; arrayRuns++; });
        createEffect(() => { store.users[0](); itemRuns++; });
        createEffect(() => { store.users[0].meta(); untouchedNestedRuns++; });
        await flush();
        const baseChanged = changedRuns; const baseUnchanged = unchangedRuns; const baseArray = arrayRuns;
        const baseItem = itemRuns; const baseUntouchedNested = untouchedNestedRuns;
        assert(baseChanged === 1 && changedVal === 'Ann', 'precise: changed-leaf effect initial');

        store.users.$mutate(where('id', '===', 1), update('name', 'Ada'));
        await flush();

        assert(store.users[0].name() === 'Ada', 'precise: value committed');
        assert(changedRuns > baseChanged && changedVal === 'Ada', 'precise: changed leaf woke with new value');
        assert(itemRuns > baseItem, 'precise: changed item consumer woke');
        assert(unchangedRuns === baseUnchanged, `precise: UNCHANGED sibling did NOT wake (extra=${unchangedRuns - baseUnchanged})`);
        assert(untouchedNestedRuns === baseUntouchedNested, 'precise: untouched nested branch stayed asleep');
        assert(arrayRuns > baseArray, 'precise: whole-array consumer still woke via branch signal');

        // liveQuery must still recompute under precise wake
        const q = store.users.$liveQuery(where('name', '===', 'Ada'));
        assert((q() as User[]).length === 1, 'precise: liveQuery sees committed change');
        q.dispose();

        api.destroy();
        dispose();
        resolve();
      } catch (error) {
        dispose();
        reject(error);
      }
    });
  });
}

testDeepUpdate();
testBridgeErrorMode();
await testPreciseMutationWake();
await testStoreMutateReactivity();
testLiveQueryAfterMutate();

console.log('All jsnq bridge + store mutate contract tests passed.');
