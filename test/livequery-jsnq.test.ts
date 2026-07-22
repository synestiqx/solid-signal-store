import { createRoot } from 'solid-js';
import { createSolidStore } from '../src';
import '../src/jsnq'; // registers the global jsnq bridge (required for $query/$liveQuery/$mutate)
import where from '@synestiqx/jsnq/operators/where';
import update from '@synestiqx/jsnq/operators/update';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type User = { id: number; active: boolean; name: string };
const seed = (): { users: User[]; meta: { count: number } } => ({
  users: [
    { id: 1, active: true, name: 'Ann' },
    { id: 2, active: false, name: 'Bob' },
    { id: 3, active: true, name: 'Cy' },
  ],
  meta: { count: 3 },
});

// 1. $query / $queryOne — one-shot snapshot using the same where(...) DSL as mutate
function testSnapshotQuery(): void {
  const api = createSolidStore(seed() as any, 'lq_snapshot');
  const store = api.store as any;

  const active = store.users.$query(where('active', '===', true)) as User[];
  assert(Array.isArray(active), '$query returns array');
  assert(active.length === 2, `$query filters (got ${active.length})`);
  assert(active.map((u) => u.id).join(',') === '1,3', '$query returns matched values');

  const one = store.users.$queryOne(where('id', '===', 2)) as User;
  assert(one && one.id === 2 && one.name === 'Bob', '$queryOne returns first match');

  const none = store.users.$queryOne(where('id', '===', 999));
  assert(none === null, '$queryOne returns null when no match');

  // Parity with a manual filter (the oracle)
  const manual = seed().users.filter((u) => u.active).map((u) => u.id).join(',');
  assert(active.map((u) => u.id).join(',') === manual, '$query matches manual filter oracle');

  const domainApi = createSolidStore({ rows: [{ id: 1, data: 'payload', name: 'row' }] }, 'lq_domain_data');
  const domainStore = domainApi.store as any;
  const domainRow = domainStore.rows.$queryOne(where('id', '===', 1));
  assert(domainRow?.id === 1 && domainRow.data === 'payload', '$queryOne preserves domain objects with a data field');

  const before = JSON.stringify(domainApi.readStore('rows'));
  const projected = domainStore.rows.$query(where('id', '===', 1), update('name', 'query-only'));
  assert(projected[0].name === 'query-only', '$query may transform its isolated result');
  assert(JSON.stringify(domainApi.readStore('rows')) === before, '$query actions never mutate live store data');
  domainApi.destroy();
  api.destroy();
}

// 2. $liveQuery — reactive recompute when a tracked-branch descendant changes (no global container mode)
function testLiveQueryReactivity(): void {
  createRoot((dispose) => {
    const api = createSolidStore(seed() as any, 'lq_live');
    api.wakeUp('grained'); // stay fine-grained globally; liveQuery registers its own branch interest
    const store = api.store as any;

    const q = store.users.$liveQuery(where('active', '===', true));
    assert((q() as User[]).length === 2, 'liveQuery initial result');

    // Descendant change: flipping users[0].active must wake the 'users' branch for this query
    store.users[0].active = false;
    assert((q() as User[]).length === 1, `liveQuery recomputes after users[0].active=false (got ${(q() as User[]).length})`);
    assert((q() as User[])[0].id === 3, 'liveQuery result correct after descendant change');

    // push (precise tail wake) must also refresh the query
    store.users.push({ id: 4, active: true, name: 'Dee' });
    assert((q() as User[]).map((u) => u.id).join(',') === '3,4', `liveQuery recomputes after push (got ${(q() as User[]).map((u) => u.id).join(',')})`);

    // Whole-branch replace
    store.users = [{ id: 9, active: true, name: 'Zed' }];
    assert((q() as User[]).length === 1 && (q() as User[])[0].id === 9, 'liveQuery recomputes after branch replace');

    const one = store.users.$liveQueryOne(where('id', '===', 9));
    assert((one() as User).id === 9, '$liveQueryOne initial');
    one.dispose();
    q.dispose();
    dispose();
  });
}

// 3. $subscribe — push subscription on a leaf; immediate emit + reacts + dispose (effects flush async)
async function testSubscribe(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const api = createSolidStore(seed() as any, 'lq_sub');
        const store = api.store as any;
        const seen: number[] = [];
        const sub = store.meta.count.$subscribe((v: number) => seen.push(v));
        await flush();
        assert(seen.length === 1 && seen[0] === 3, `$subscribe immediate emit (got ${JSON.stringify(seen)})`);

        store.meta.count = 5;
        await flush();
        assert(seen[seen.length - 1] === 5, `$subscribe reacts to change (got ${JSON.stringify(seen)})`);

        sub.dispose();
        store.meta.count = 7;
        await flush();
        assert(seen[seen.length - 1] === 5, '$subscribe stops after dispose');

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

// 4. $-aliases work and are the collision-free namespace next to bare names
function testDollarAliases(): void {
  const api = createSolidStore(seed() as any, 'lq_alias');
  const store = api.store as any;

  // $mutate alias resolves to mutate
  store.users.$mutate(where('id', '===', 1), update('active', false));
  const afterMutate = api.readStore('users') as User[];
  assert(afterMutate.find((u) => u.id === 1)!.active === false, '$mutate alias performs the mutation');

  // $query is the dedicated jsnq read (NOT the array-parity query)
  const admins = store.users.$query(where('active', '===', true)) as User[];
  assert(admins.length === 1 && admins[0].id === 3, '$query alias works alongside $mutate');

  // Root-level $query (deep search across the whole tree)
  const rootActive = store.$query(where('active', '===', true)) as User[];
  assert(rootActive.length === 1 && rootActive[0].id === 3, 'root $query deep-searches the tree');
  api.destroy();
}

// 5. $liveQuery lifecycle — inline subscribe(...).dispose() must fully clean up (no callback after
//    dispose) and the handle's own dispose() stays idempotent; a fresh query afterwards still works.
async function testLiveQueryDispose(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    createRoot(async (dispose) => {
      try {
        const api = createSolidStore(seed() as any, 'lq_dispose');
        const store = api.store as any;
        const seen: number[] = [];

        // Inline pattern: no handle kept — the subscription must own the full cleanup.
        const sub = store.users.$liveQuery(where('active', '===', true))
          .subscribe((rows: User[]) => seen.push(rows.length));
        await flush();
        assert(seen.length === 1 && seen[0] === 2, `inline liveQuery immediate (got ${JSON.stringify(seen)})`);

        store.users[1].active = true; // 2 -> 3 active
        await flush();
        assert(seen[seen.length - 1] === 3, `inline liveQuery reacts (got ${JSON.stringify(seen)})`);

        sub.dispose();
        const countAtDispose = seen.length;
        store.users[0].active = false; // would change result if still live
        await flush();
        assert(seen.length === countAtDispose, 'inline liveQuery stops after dispose (no leaked branch wake)');
        sub.dispose(); // idempotent — must not throw

        // A brand-new query after dispose still works (registry/branch state not corrupted)
        const fresh = store.users.$liveQuery(where('active', '===', true));
        assert(Array.isArray(fresh()), 'fresh liveQuery after dispose works');
        fresh.dispose();

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

testSnapshotQuery();
testLiveQueryReactivity();
await testSubscribe();
testDollarAliases();
await testLiveQueryDispose();

console.log('All solid liveQuery / $query / $subscribe / $-alias tests passed.');
