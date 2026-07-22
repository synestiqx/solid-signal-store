import { createMemo, createRoot } from 'solid-js';
import { createSolidStore, onSolidDevAction } from '../src';
import '../src/jsnq';
import where from '@adsq/jsnq/operators/where';
import update from '@adsq/jsnq/operators/update';
import insert from '@adsq/jsnq/operators/insert';
import moveToMatches from '@adsq/jsnq/operators/moveToMatches';

type WakeMode = 'grained' | 'container';

type Post = {
  title: string;
  content: string;
};

type Item = {
  id: string;
  title: string;
  status: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  owner?: string;
};

type Lane = {
  id: string;
  title: string;
  items: Item[];
};

type Board = {
  name: string;
  lanes: Lane[];
  archive: {
    shipped?: Item[];
    rejected?: Item[];
    escalated?: Item[];
  };
};

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function createTable(): Board[] {
  return [
    {
      name: 'Warehouse Board',
      lanes: [
        {
          id: 'incoming',
          title: 'Incoming',
          items: [
            { id: 'shipment-1001', title: 'Components A', status: 'incoming', priority: 'high', tags: ['urgent'], owner: 'Anna' },
            { id: 'shipment-1002', title: 'M4 screws pallet', status: 'incoming', priority: 'medium', tags: ['standard'], owner: 'Piotr' },
          ],
        },
        {
          id: 'processing',
          title: 'Processing',
          items: [
            { id: 'shipment-2001', title: 'Assembly kit B', status: 'processing', priority: 'medium', tags: ['assembly'], owner: 'Agata' },
          ],
        },
      ],
      archive: { shipped: [], rejected: [], escalated: [] },
    },
  ];
}

function createState() {
  return {
    storeComponent: {
      key: 'dasd',
      val: 'sdasdasd',
      table: createTable(),
      user: {
        profile: {
          name: 'John',
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
        posts: [
          { title: 'Post 1', content: 'Content 1' },
          { title: 'Post 2', content: 'Content 2' },
        ] as Post[],
      },
    },
  };
}

function lane(table: Board[], laneId: string): Lane {
  const found = table[0]?.lanes.find((item) => item.id === laneId);
  assert(found, `lane exists: ${laneId}`);
  return found!;
}

function audit(store: any, api: ReturnType<typeof createSolidStore>) {
  const posts = store.storeComponent.user.posts() as Post[];
  const table = api.readStore('storeComponent.table') as Board[];
  const processing = lane(table, 'processing').items;
  const incoming = lane(table, 'incoming').items;
  return {
    key: store.storeComponent.key(),
    val: store.storeComponent.val(),
    name: store.storeComponent.user.profile.name(),
    theme: store.storeComponent.user.profile.settings.theme(),
    firstTitle: store.storeComponent.user.posts[0].title(),
    postsCount: posts.length,
    taggedCount: posts.filter((post) => post.content.includes('[tagged]')).length,
    foundJsnq: !!store.storeComponent.user.posts.find((post: Post) => post.title === 'JSNQ Post'),
    filteredTagged: (store.storeComponent.user.posts.filter((post: Post) => post.content.includes('[tagged]')) as Post[]).length,
    hasProxyPost: store.storeComponent.user.posts.some((post: Post) => post.title === 'Proxy Post'),
    lengthViaProxy: store.storeComponent.user.posts.length,
    incomingIds: incoming.map((item) => item.id),
    processingIds: processing.map((item) => item.id),
  };
}

async function runScenario(batch: boolean, wakeMode: WakeMode) {
  const scenario = createRoot((dispose) => {
    const api = createSolidStore(createState(), `solid_store_component_${batch}_${wakeMode}`);
    const store = api.store as any;
    const devEvents: any[] = [];
    const unsubscribe = onSolidDevAction((event) => {
      if (event.storeName === `solid_store_component_${batch}_${wakeMode}`) devEvents.push(event);
    });
    api.enableDevTools(`solid_store_component_${batch}_${wakeMode}`);
    api.wakeUp(wakeMode);

    let parentRuns = 0;
    let firstTitleRuns = 0;
    const postsMemo = createMemo(() => {
      parentRuns++;
      return store.storeComponent.user.posts();
    });
    const firstTitleMemo = createMemo(() => {
      firstTitleRuns++;
      return store.storeComponent.user.posts[0].title();
    });

    assert(store.storeComponent.key() === 'dasd', `${batch}/${wakeMode}: initial key callable`);
    assert(postsMemo().length === 2, `${batch}/${wakeMode}: initial posts callable`);
    assert(firstTitleMemo() === 'Post 1', `${batch}/${wakeMode}: initial nested callable`);

    const parentBefore = parentRuns;
    const firstBefore = firstTitleRuns;
    const write = (fn: () => void) => {
      const run = () => {
        api.wakeUp(wakeMode);
        fn();
      };
      if (batch) api.batch(run);
      else run();
    };

    write(() => {
      store.storeComponent.key = 'solid-key-flow';
      api.setValue('storeComponent.val', 'native-val-flow');
      store.storeComponent.user.profile.name = 'Solid User Flow';
      api.setValue('storeComponent.user.profile.settings.theme', 'contrast');
      store.storeComponent.user.posts.push({ title: 'Proxy Post', content: 'from proxy push' });
      store.storeComponent.user.posts[0].title = 'Proxy Updated Title';
      api.mutate('storeComponent.user.posts', insert({ title: 'JSNQ Post', content: 'from jsnq insert' }, 'inside'));
      api.mutate('storeComponent.user.posts', where('title', 'includes', 'Post'), update('content', (current: string) => `${current} [tagged]`));
      api.mutate(
        'storeComponent.table',
        where('id', '===', 'shipment-1002'),
        update('status', () => 'processing'),
        moveToMatches('id', '===', 'processing', 'inside', 'items')
      );
    });

    const result = audit(store, api);
    assert(result.key === 'solid-key-flow', `${batch}/${wakeMode}: direct key`);
    assert(result.val === 'native-val-flow', `${batch}/${wakeMode}: native val`);
    assert(result.name === 'Solid User Flow', `${batch}/${wakeMode}: direct nested user`);
    assert(result.theme === 'contrast', `${batch}/${wakeMode}: native nested theme`);
    assert(result.firstTitle === 'Proxy Updated Title', `${batch}/${wakeMode}: nested array title`);
    assert(result.postsCount === 4, `${batch}/${wakeMode}: posts count`);
    assert(result.taggedCount >= 3, `${batch}/${wakeMode}: jsnq tag posts`);
    assert(result.foundJsnq, `${batch}/${wakeMode}: query find JSNQ post`);
    assert(result.filteredTagged >= 3, `${batch}/${wakeMode}: query filter tagged posts`);
    assert(result.hasProxyPost, `${batch}/${wakeMode}: query some proxy post`);
    assert(result.lengthViaProxy === 4, `${batch}/${wakeMode}: array length proxy`);
    assert(result.processingIds.includes('shipment-1002'), `${batch}/${wakeMode}: jsnq move into processing`);
    assert(!result.incomingIds.includes('shipment-1002'), `${batch}/${wakeMode}: jsnq move removes from incoming`);
    assert(firstTitleMemo() === 'Proxy Updated Title', `${batch}/${wakeMode}: memo sees final title`);

    return {
      dispose,
      unsubscribe,
      devEvents,
      result,
      parentDelta: parentRuns - parentBefore,
      firstTitleDelta: firstTitleRuns - firstBefore,
    };
  });

  await Promise.resolve();
  await Promise.resolve();

  assert(scenario.devEvents.some((event) => event.type === 'SET_VALUE'), `${batch}/${wakeMode}: dev SET_VALUE emitted`);
  assert(scenario.devEvents.some((event) => event.type === 'MUTATE'), `${batch}/${wakeMode}: dev MUTATE emitted`);
  assert(scenario.devEvents.some((event) => event.type === 'ARRAY_DISPATCH'), `${batch}/${wakeMode}: dev ARRAY_DISPATCH emitted`);

  scenario.unsubscribe();
  scenario.dispose();
  return scenario;
}

const results = [
  await runScenario(false, 'grained'),
  await runScenario(true, 'grained'),
  await runScenario(false, 'container'),
  await runScenario(true, 'container'),
];

for (const result of results) {
  console.log('solid-store-component-flow:', {
    result: result.result,
    parentDelta: result.parentDelta,
    firstTitleDelta: result.firstTitleDelta,
  });
}

console.log('All solid store component flow tests passed.');
