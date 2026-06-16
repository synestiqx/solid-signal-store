# solidstore

Solid-first reactive JSON store with callable proxy reads, direct proxy writes, batched mutations, targeted wake-up, and optional JsonDB operators.

The package is designed to be installed directly from GitHub:

```bash
bun add github:synestiqx/solidstore
```

```ts
import { createMemo } from 'solid-js';
import { createSolidStore } from 'solidstore';
import 'solidstore/jsondb';
import where from 'solidstore/jsondb/synced/operators/where';
import update from 'solidstore/jsondb/synced/operators/update';

const api = createSolidStore({
  users: [
    { id: 1, name: 'Anna', age: 28 },
    { id: 2, name: 'Jan', age: 35 },
  ],
}, 'app');

const store = api.store;
const adultCount = createMemo(() => store.users().filter((u) => u.age >= 18).length);

store.users[0].age = 30;
store.users.push({ id: 3, name: 'Ola', age: 22 });

store.users.mutate(
  where('id', '===', 1),
  update('name', 'Ada')
);

api.batch(() => {
  store.users[1].age = 36;
  api.wakePath('users.1.age', 'grained');
});

const subscription = api.select(
  (state) => state.users().length,
  { immediate: true, equals: Object.is }
).subscribe((count) => {
  console.log('users:', count);
});
subscription.dispose();
```

## API Surface

- `store.path()` reads the current value through Solid tracking.
- `store.path = value`, `delete store.path`, and array methods mutate through the proxy.
- `api.batch(fn)` uses Solid batching.
- `api.setWakeMode('grained' | 'container')` changes global wake behavior.
- `api.wakePath(path, 'grained' | 'leaf')` wakes one path exactly or with parent/container semantics.
- `api.wakeUp(...)` remains as the compatibility alias for both wake APIs.
- `api.select(project, { equals, immediate, onError })` returns a hot observable-like subscription with `unsubscribe()` and `dispose()`.
- `import 'solidstore/jsondb'` registers JsonDB mutation support only when needed.
- `createSolidStore(data, name, { jsondbBridge })` can inject the bridge explicitly for SSR/tests; the global registration remains a compatibility fallback.

JsonDB path/data primitives are exported separately:

```ts
import { createJsonPathPlan, readJsonPath, writeJsonPath } from 'solidstore/jsondb/data-engine';
```

The main `solidstore` import uses only the lightweight data-engine helpers needed by the proxy/store path. The full JsonDB pipeline is behind the `solidstore/jsondb` entry.

## Scripts

```bash
bun install
bun run build
```

This GitHub package is intentionally minimal for install/clone usage. The full Angular/Solid workspace keeps the extended Node, Playwright, sync, and benchmark tests outside this published package.

## Architecture

- `src/core/SolidStore.ts` is the public orchestrator.
- `src/proxy/solid-proxy.ts` owns callable proxy identity and Solid signal wake-up.
- `src/array/solid-array.ts` owns array dispatch and copy-on-write array mutations.
- `src/jsondb/synced/` is a byte-identical synced copy of the canonical Angular JsonDB runtime.
- `src/jsondb/solid-pipeline-bridge.ts` is the Solid-specific integration layer.
- `src/jsondb/synced/core/data-engine.ts` is the shared path/data primitive layer used by JsonDB and the store hot paths.

Quality gates currently cover deep proxy writes, nested JsonDB flows, select reactivity, wake/batch behavior, nested CMS-style moves, browser DOM checks, and JsonDB sync parity.
