import { createSolidStore, onSolidDevAction } from '../src';
import '../src/jsondb';
import where from '@synestiqx/jsondb/operators/where';
import update from '@synestiqx/jsondb/operators/update';
import insert from '@synestiqx/jsondb/operators/insert';
import moveToMatches from '@synestiqx/jsondb/operators/moveToMatches';

type FieldNode = {
  id: string;
  data: string;
  settings: {
    style: { color: string; weight: number };
    validators: { rules: Array<{ id: string; enabled: boolean; history: string[] }> };
  };
  fields: FieldNode[];
};

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function field(id: string, fields: FieldNode[] = []): FieldNode {
  return {
    id,
    data: `${id}-data`,
    settings: {
      style: { color: 'blue', weight: 1 },
      validators: { rules: [{ id: `${id}-required`, enabled: true, history: ['init'] }] },
    },
    fields,
  };
}

function createState() {
  return {
    workspace: {
      pages: [
        {
          id: 'page-home',
          sections: [
            {
              id: 'section-hero',
              blocks: [
                field('hero-title', [field('hero-title-child')]),
                field('hero-cta'),
              ],
            },
            {
              id: 'section-content',
              blocks: [
                field('article-list', [field('article-card'), field('author-badge')]),
                field('footer-cta'),
              ],
            },
          ],
        },
      ],
      audit: {
        events: [] as Array<{ type: string; path: string; value: string }>,
      },
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const api = createSolidStore(createState(), 'solid_deep_proxy_jsondb_flow');
const store = api.store as any;
const events: any[] = [];
const unsubscribe = onSolidDevAction((event) => {
  if (event.storeName === 'solid_deep_proxy_jsondb_flow') events.push(event);
});
api.enableDevTools('solid_deep_proxy_jsondb_flow');
api.wakeUp('grained');

const title = store.workspace.pages[0].sections[0].blocks[0];
assert(title.data() === 'hero-title-data', 'deep callable read before proxy assignment');

title.data = 'Hero Title Updated';
title.settings.style.color = 'red';
title.settings.validators.rules[0].history.push('proxy-push');
store.workspace.audit.events.push({ type: 'proxy', path: 'workspace.pages.0.sections.0.blocks.0.data', value: title.data() });

assert(store.workspace.pages[0].sections[0].blocks[0].data() === 'Hero Title Updated', 'deep proxy assignment updates callable read');
assert(store.workspace.pages[0].sections[0].blocks[0].settings.style.color() === 'red', 'deeper style assignment updates callable read');
assert(store.workspace.pages[0].sections[0].blocks[0].settings.validators.rules[0].history.length === 2, 'deep proxy push updates nested array length');

store.workspace.pages[0].sections[1].blocks.mutate(
  where('id', '===', 'footer-cta'),
  update('settings.style.color', () => 'green')
);
store.workspace.pages[0].sections[1].blocks.mutate(
  insert(field('jsondb-inserted'), 'inside')
);
store.workspace.pages[0].sections[1].blocks.mutate(
  where('id', '===', 'article-card'),
  moveToMatches('id', '===', 'footer-cta', 'after')
);

await flush();

const contentBlocks = store.workspace.pages[0].sections[1].blocks() as FieldNode[];
const footer = contentBlocks.find((item) => item.id === 'footer-cta');
const inserted = contentBlocks.find((item) => item.id === 'jsondb-inserted');
const articleList = contentBlocks.find((item) => item.id === 'article-list');
assert(footer?.settings.style.color === 'green', 'jsondb update on deep style path');
assert(!!inserted, 'jsondb insert into nested blocks');
assert(!articleList?.fields.some((item) => item.id === 'article-card'), 'jsondb move removes nested source from child fields');
assert(contentBlocks.some((item) => item.id === 'article-card'), 'jsondb move adds source beside target');
assert(store.workspace.audit.events.length === 1, 'proxy push audit event recorded');

await flush();
const invalidPath = events
  .map((event) => String(event.payload?.path ?? ''))
  .find((path) => /\.(push|mutate|pipe|subscribe)(\.|$)/.test(path));
assert(!invalidPath, `proxy/jsondb method names must not leak into devtools paths, got ${invalidPath}`);
assert(events.some((event) => String(event.payload?.path ?? '') === 'workspace.pages.0.sections.0.blocks.0.data'), 'deep assignment path logged');
assert(events.some((event) => String(event.payload?.path ?? '') === 'workspace.pages.0.sections.1.blocks'), 'jsondb nested blocks path logged');

unsubscribe();
api.destroy();
console.log('All solid deep proxy jsondb flow tests passed.');
