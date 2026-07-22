---
name: @adsq/solid-signal-store
description: Use @adsq/solid-signal-store to build SolidJS state as a callable nested proxy — reads like store.user.name(), writes like store.user.name = 'Ada', with fine-grained per-path wake and JSNQ queries over arrays. Use when writing or reviewing Solid components, JSX, or stores in a project that depends on @adsq/solid-signal-store, and when building live-editing UIs such as slider-driven design tools.
---

# @adsq/solid-signal-store

A reactive store for SolidJS built on a callable nested proxy. Reading a path returns its
value and subscribes the caller to that exact path; assigning to it writes and wakes only
the consumers of that path. State reads and writes look like ordinary nested object access.

Install: `npm install solid-js @adsq/solid-signal-store`. `@adsq/jsnq` is a peer dependency
and installs automatically; declare it too when the app imports JSNQ operators directly.

## The architecture rule — read this first

**Build the entire application on the store, with no native signals of your own.** Do not
create `createSignal()` copies of data that already lives in the store, and do not keep a
parallel signal alongside a store path. A copy is a second source of truth: the store write
updates the proxy, the copy keeps the stale value, and the UI desyncs in a way that is hard
to trace.

State goes in the store. JSX reads the store. Handlers assign to the store. That is the
whole loop. If a component needs derived data, use `createMemo` that *reads store paths* —
never one that captures a snapshot once.

```tsx
// WRONG — a second source of truth that will drift
const [name, setName] = createSignal(store.user.name());

// RIGHT — derives from the store on every read
const greeting = createMemo(() => `Hello ${store.user.name()}`);
```

## Where this store is a particularly good fit

Live-editing interfaces where many small values change continuously and each one drives a
different piece of the DOM — **design tools whose sliders modify appearance and style in
real time**. A slider bound to `store.design.card.radius` wakes only the bindings that read
that path, so dragging it does not re-render the rest of the editor. The same applies to
theme editors, layout inspectors, and property panels: dozens of independent numeric
inputs, each with its own narrow set of consumers.

## Creating a store

```ts
import { createSolidStore } from '@adsq/solid-signal-store';

const api = createSolidStore({
  user: { name: 'Ann', tags: ['admin'] },
  dashboard: { tiles: 12 },
  services: [{ name: 'api', rps: 120 }],
}, 'app');

const store = api.store;
```

When a module owns the `api`/`store` reference, use it directly. `waitForStore` is only for
a separately loaded consumer that may run before the owner creates the named store:

```ts
import { useSolidStore, waitForStore } from '@adsq/solid-signal-store';

const pending = await waitForStore('app', { timeoutMs: 5_000 });
useSolidStore('app'); // synchronous; throws when missing
```

`api` also carries `batch`, `wakeUp`, `destroy`, `attachDevtools`, and `enableDevTools`.

## Reading and writing

```ts
store.user.name();                                  // reactive read
store.user.name = 'Ada';                            // write
store.dashboard.tiles = store.dashboard.tiles() + 1;
store.user.tags.push('maintainer');
store.user.tags.pop();
store.user.preferences = {};                        // dynamic nested keys
store.user.preferences.theme = 'dark';
```

For static type safety, declare optional/dynamic fields in the state interface or use an
index signature such as `[key: string]: unknown`.

## In JSX

```tsx
function Dashboard() {
  return (
    <>
      <h1>{store.user.name()}</h1>
      <p>{store.dashboard.tiles()} tiles</p>

      <For each={store.user.tags()}>{(tag: string) =>
        <span class="tag">{tag}</span>
      }</For>

      <For each={store.services()}>{(service: any) =>
        <div class="row">
          <strong>{service.name}</strong>
          <span>{service.rps}</span>
        </div>
      }</For>

      <span>{store.history.length} samples</span>

      <button onClick={() => store.dashboard.tiles = store.dashboard.tiles() + 1}>
        Add tile
      </button>
    </>
  );
}
```

Three rules cover every component:

1. **A leaf is called.** `{store.user.name()}`. The call *is* the reactive read, so Solid
   updates only the text node bound to that path.
2. **An array is called to iterate it, and each item is a plain value.** Write
   `<For each={store.services()}>` and then `{service.name}` — **no parentheses on the
   item**. Items are snapshots, not nested accessors. This is the most common mistake.
3. **`length` is reactive without a call.** `{store.history.length}` tracks pushes and pops
   without materialising the array.

Index into nested collections directly when the exact leaf matters:
`store.board.rows[rowIndex()].cells[colIndex()].value()`.

## Batching and wake modes

```ts
api.batch(() => {
  store.user.name = 'Ada';
  store.dashboard.tiles = 16;
});

api.wakeUp('grained');              // default mode for subsequent writes
api.wakeUp('container');            // parent-chain mode for subsequent writes
api.wakeUp('user.name', 'grained'); // wake exactly this path now
api.wakeUp('user.name', 'leaf');    // wake this path and its parent chain now
```

| Mode | Paths dirtied | Use |
| --- | --- | --- |
| `grained` | Exact changed path only | Default and fastest. |
| `leaf` | Exact path plus parent chain | For effects/memos consuming a container. |

`fine` and `exact` alias `grained`; `container`, `parents`, and `branch` alias `leaf`. The
one-argument form changes the default; the two-argument form is a one-off targeted wake.

Writes inside `batch()` stay synchronous and immediately readable. A single write needs no
batch. The store option `preciseMutationWake: true` lets eligible flat JSNQ mutations wake
only the changed branch, item, and leaf; deep/structural mutations fall back to a branch
commit.

## Queries and bulk mutations (JSNQ)

The core proxy does not import the JSNQ bridge. Import it once in an application that calls
`mutate`, `$query`, or `$liveQuery` — otherwise those calls throw an actionable error:

```ts
import '@adsq/solid-signal-store/jsnq';
import where from '@adsq/jsnq/operators/where';
import update from '@adsq/jsnq/operators/update';

store.userList.mutate(
  where('active', '===', true),
  update('score', (score: number) => score + 1),
);

const active = store.userList.$query(where('active', '===', true));    // snapshot
const live   = store.userList.$liveQuery(where('active', '===', true)); // accessor

live();                                   // read inside a Solid owner
const sub = live.subscribe((v) => {});     // optional subscription
sub.unsubscribe();
live.dispose();
```

Dispose live queries and subscriptions created outside a component owner.

## Devtools and cleanup

```ts
if (import.meta.env.DEV) {
  const { createSolidDevtools } = await import('@adsq/solid-signal-store/devtools');
  api.attachDevtools(createSolidDevtools());
  api.enableDevTools('app');
}

api.destroy(); // idempotent; clears caches, subscriptions, and the devtools adapter
```

## Checklist when writing code against this store

- Never mirror store data into `createSignal`; read the store path instead.
- Call leaves (`path()`), do not call loop items (`item.field`).
- Import `@adsq/solid-signal-store/jsnq` once before using `mutate` / `$query`.
- Reach for `api.batch()` only when several writes must land as one update.
- Dispose live queries created outside a component owner.
- Do not import from `dist/` or deep internal paths; use the documented entries only.
