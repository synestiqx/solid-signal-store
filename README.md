# SolidStore

Fine-grained SolidJS store with a callable proxy API and optional JSNQ/devtools entries. State reads and writes look like ordinary nested object access while Solid tracks only paths that are actually consumed.

## Install

```sh
npm install solid-js @adsq/jsnq @adsq/solid-signal-store
# or
bun add solid-js @adsq/jsnq @adsq/solid-signal-store
```

Solid `>=1.8 <2` and `@adsq/jsnq` are peer dependencies, so the application supplies one framework runtime. The test matrix covers the minimum supported Solid line and current Solid 1.9.

## Create And Use A Store

```ts
import { createSolidStore } from '@adsq/solid-signal-store';

const api = createSolidStore({
  user: { name: 'Ann', tags: ['admin'] },
  dashboard: { tiles: 12 },
}, 'app');

const store = api.store;

store.user.name();                 // reactive read
store.user.name = 'Ada';           // direct proxy write
store.user.tags.push('maintainer');
store.user.tags.pop();
store.dashboard.tiles = store.dashboard.tiles() + 1;
```

Nested keys may be created dynamically:

```ts
store.user.preferences = {};
store.user.preferences.theme = 'dark';
store.user.preferences.theme(); // 'dark'
```

For static TypeScript safety, declare optional/dynamic fields in the state interface or use an index signature such as `[key: string]: unknown`.

## JSNQ Is Optional

The core proxy does not import the JSNQ pipeline bridge. Import the bridge only in an application that calls `mutate`, `$query`, or `$liveQuery`:

```ts
import '@adsq/solid-signal-store/jsnq';
import where from '@adsq/jsnq/operators/where';
import update from '@adsq/jsnq/operators/update';

store.userList.mutate(
  where('active', '===', true),
  update('score', (score: number) => score + 1),
);

const active = store.userList.$query(where('active', '===', true));
const liveActive = store.userList.$liveQuery(where('active', '===', true));
const subscription = liveActive.subscribe((users) => console.log(users));

liveActive(); // current reactive value inside a Solid owner
subscription.unsubscribe();
liveActive.dispose();
```

`$query` and `$queryOne` are one-shot snapshots. `$liveQuery` and `$liveQueryOne`
return callable Solid accessors; they recompute after the queried branch changes and can
also be subscribed to. Dispose live queries and subscriptions created outside a component
owner. Calling a JSNQ operation without the optional bridge throws an actionable error
instead of silently doing nothing. Individual operators remain separate imports.

## Lazy Creation

The initial state is cloned when `createSolidStore` is called. Reactive infrastructure is lazy:

- nested callable proxies are created on first property navigation and cached with weak references;
- path signals are created on first reactive read;
- computed projections and live queries are created only when requested;
- subscriptions allocate an effect only on `subscribe()` and dispose it on unsubscribe;
- JSNQ code enters the graph only through `@adsq/solid-signal-store/jsnq`;
- devtools code enters the graph only through `@adsq/solid-signal-store/devtools`;
- named-store waiters exist only while code is waiting for a store.

Unused paths have no signal, computed node, BehaviorSubject, or subscription allocation.

## Named Stores And Async Creation

When a module or service owns the `api`/`store` reference returned by `createSolidStore`, use that reference directly. `waitForStore` is only for a separate asynchronously loaded consumer that may run before the owner creates the named store.

```ts
import { createSolidStore, useSolidStore, waitForStore } from '@adsq/solid-signal-store';

const pending = waitForStore('dashboard', { timeoutMs: 5_000 });

queueMicrotask(() => {
  createSolidStore({ tiles: 12 }, 'dashboard');
});

const dashboardApi = await pending;
dashboardApi.store.tiles();

useSolidStore('dashboard'); // synchronous; throws when missing
```

`waitForStore` is event-driven, supports `AbortSignal`, does not poll, and removes its timer/listener after resolve, timeout, or abort.

## Batch And Wake Modes

```ts
api.batch(() => {
  store.user.name = 'Ada';
  store.dashboard.tiles = 16;
});

api.wakeUp('grained');             // set future writes to exact-path mode
api.wakeUp('container');           // set future writes to parent-chain mode
api.wakeUp('user.name', 'grained'); // wake exactly this path now
api.wakeUp('user.name', 'leaf');    // wake this path and its parent chain now
```

Canonical wake modes:

| Mode | Paths dirtied | Use case |
| --- | --- | --- |
| `grained` | Exact changed path only | Default and fastest; consumers read the leaf they need. |
| `leaf` | Exact path plus its parent chain | Compatibility for effects/memos that consume a container. |

`fine` and `exact` alias `grained`; `container`, `parents`, and `branch` alias
`leaf`. The one-argument form changes the default for subsequent writes. The two-argument
form performs an explicit targeted wake without changing that default.

State writes inside `batch()` are still synchronous and immediately readable. Solid delays
effect/computation flushing until the outermost batch returns, so several writes produce one
coherent reactive update. Nested batches are supported. A single write does not require an
explicit batch, and array/JSNQ operations batch their internal multi-step commits where needed.
`preciseMutationWake: true` lets eligible flat JSNQ mutations wake only the changed branch,
item, and leaf instead of every observed descendant; structural/deep mutations safely fall
back to a branch commit.

## Devtools Only In Development

```ts
if (import.meta.env.DEV) {
  const { createSolidDevtools } = await import('@adsq/solid-signal-store/devtools');
  api.attachDevtools(createSolidDevtools());
  api.enableDevTools('app');
}
```

The main entry exports only the adapter types; it does not construct a devtools service.

## Cleanup

```ts
api.destroy();
```

Destroy is idempotent, removes the named registry entry only when it still owns it, clears signal/proxy/query caches, subscriptions, and the attached devtools adapter.

## Verify

```sh
bun run demo:install
bun run dev       # Store, Design, and Dashboard browser demo
bun run typecheck
bun run test
bun run build
bun run test:browser
```

## Bundle Size

Measured from the built ESM with esbuild minification. `solid-js` and JSNQ remain external peers:

| Entry | Minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| SolidStore core | 27.5 kB | 9.0 kB | 8.1 kB |
| Optional JSNQ bridge | 1.8 kB | 0.8 kB | 0.7 kB |
| Optional devtools | 0.8 kB | 0.4 kB | 0.4 kB |

The production browser demo, including Solid and the used JSNQ operators, is approximately 58.0 kB minified / 18.8 kB gzip.

## License

MIT
