import { createEffect, createRoot } from 'solid-js';
import { createSolidStore } from '../src';
import '../src/jsondb';
import where from '@synestiqx/jsondb/operators/where';
import update from '@synestiqx/jsondb/operators/update';
import moveToMatches from '@synestiqx/jsondb/operators/moveToMatches';

type NestableMode = 'jsondb' | 'direct' | 'native';
type NestableMovePosition = 'before' | 'after' | 'child';
type NestableWakeMode = 'grained' | 'container';

interface NestableNode {
  id: string;
  label: string;
  kind: 'page' | 'section' | 'block' | 'field';
  slug: string;
  path: string;
  depth: number;
  order: number;
  expanded: boolean;
  data: string;
  fields: NestableNode[];
}

const steps = [
  { sourceId: 'hero', targetId: 'settings', position: 'child' },
  { sourceId: 'downloads', targetId: 'dashboard', position: 'before' },
  { sourceId: 'articleCard', targetId: 'footerCta', position: 'after' },
  { sourceId: 'access', targetId: 'articleList', position: 'child' },
] as const;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function node(id: string, label: string, kind: NestableNode['kind'], fields: NestableNode[] = []): NestableNode {
  return { id, label, kind, slug: id, path: '', depth: 0, order: 0, expanded: true, data: `${label} data`, fields };
}

function refresh(fields: NestableNode[], parentPath = '', depth = 0): NestableNode[] {
  fields.forEach((item, index) => {
    item.fields = Array.isArray(item.fields) ? item.fields : [];
    item.order = index;
    item.depth = depth;
    item.path = parentPath ? `${parentPath}/${item.slug || item.id}` : `/${item.slug || item.id}`;
    refresh(item.fields, item.path, depth + 1);
  });
  return fields;
}

function createState() {
  return {
    nestable: {
      page: {
        fields: refresh([
          node('dashboard', 'Dashboard', 'page'),
          node('content', 'Content', 'section', [
            node('hero', 'Hero', 'block'),
            node('articleList', 'Article List', 'block', [
              node('articleCard', 'Article Card', 'field'),
              node('authorBadge', 'Author Badge', 'field'),
            ]),
            node('footerCta', 'Footer CTA', 'block'),
          ]),
          node('settings', 'Settings', 'section', [
            node('seo', 'SEO', 'field'),
            node('access', 'Access Rules', 'field'),
          ]),
          node('media', 'Media', 'section', [
            node('gallery', 'Gallery', 'block'),
            node('downloads', 'Downloads', 'block'),
          ]),
        ]),
      },
    },
  };
}

function flatten(fields: NestableNode[], out: NestableNode[] = []): NestableNode[] {
  for (const item of fields) {
    out.push(item);
    flatten(item.fields, out);
  }
  return out;
}

function find(fields: NestableNode[], id: string): NestableNode | undefined {
  for (const item of fields) {
    if (item.id === id) return item;
    const nested = find(item.fields, id);
    if (nested) return nested;
  }
  return undefined;
}

function findContainer(fields: NestableNode[], id: string, parent: NestableNode[] | null = null): { node: NestableNode; parent: NestableNode[] | null; index: number } | undefined {
  for (let index = 0; index < fields.length; index++) {
    const item = fields[index]!;
    if (item.id === id) return { node: item, parent, index };
    const nested = findContainer(item.fields, id, item.fields);
    if (nested) return nested;
  }
  return undefined;
}

function detach(fields: NestableNode[], id: string): NestableNode | undefined {
  for (let index = 0; index < fields.length; index++) {
    if (fields[index]?.id === id) return fields.splice(index, 1)[0];
    const nested = detach(fields[index]!.fields, id);
    if (nested) return nested;
  }
  return undefined;
}

function isDescendant(fields: NestableNode[], ancestorId: string, targetId: string): boolean {
  const ancestor = find(fields, ancestorId);
  return ancestor ? !!find(ancestor.fields, targetId) : false;
}

function moveDirect(fields: NestableNode[], sourceId: string, targetId: string, position: NestableMovePosition): NestableNode[] {
  assert(sourceId !== targetId, 'source and target should differ');
  assert(!isDescendant(fields, sourceId, targetId), 'source cannot move inside its own branch');
  const next = structuredClone(fields) as NestableNode[];
  const moved = detach(next, sourceId);
  const target = findContainer(next, targetId);
  assert(moved, `source should exist: ${sourceId}`);
  assert(target, `target should exist: ${targetId}`);
  if (position === 'child') {
    target!.node.expanded = true;
    target!.node.fields.push(moved!);
  } else {
    const targetFields = target!.parent ?? next;
    targetFields.splice(position === 'before' ? target!.index : target!.index + 1, 0, moved!);
  }
  return refresh(next);
}

function ids(fields: NestableNode[] | undefined): string[] {
  return (fields ?? []).map((item) => item.id);
}

function assertExpected(fields: NestableNode[], label: string): void {
  const all = flatten(fields);
  assert(all.length === 13, `${label}: no nodes lost`);
  assert(new Set(all.map((item) => item.id)).size === 13, `${label}: ids stay unique`);
  assert(ids(fields).join(',') === 'downloads,dashboard,content,settings,media', `${label}: root order`);
  assert(ids(find(fields, 'content')?.fields).join(',') === 'articleList,footerCta,articleCard', `${label}: content children`);
  assert(ids(find(fields, 'articleList')?.fields).join(',') === 'authorBadge,access', `${label}: articleList children`);
  assert(ids(find(fields, 'settings')?.fields).join(',') === 'seo,hero', `${label}: settings children`);
  assert(ids(find(fields, 'media')?.fields).join(',') === 'gallery', `${label}: media children`);
}

function runScenario(mode: NestableMode, batch: boolean, wakeMode: NestableWakeMode) {
  return createRoot((dispose) => {
    const api = createSolidStore(createState() as unknown as Record<string, unknown>, `solid_nestable_${mode}_${batch}_${wakeMode}`);
    const store = api.store as any;
    api.wakeUp(wakeMode);

    let rootEffectRuns = 0;
    let leafEffectRuns = 0;
    createEffect(() => {
      void store.nestable.page.fields();
      rootEffectRuns++;
    });
    createEffect(() => {
      void store.nestable.page.fields[0].label();
      leafEffectRuns++;
    });

    const readFields = () => api.readStore('nestable.page.fields') as NestableNode[];
    const commitFields = (fields: NestableNode[]) => {
      if (mode === 'direct') {
        store.nestable.page.fields = fields;
        return;
      }
      api.setValue('nestable.page.fields', fields);
    };
    const runWrite = (fn: () => void) => {
      const run = () => {
        fn();
        api.wakeUp(wakeMode);
      };
      if (batch) api.batch(run);
      else run();
    };

    assert(ids(store.nestable.page.fields()).join(',') === 'dashboard,content,settings,media', `${mode}/${batch}/${wakeMode}: callable read`);
    assert(store.nestable.page.fields[1].fields[1].id() === 'articleList', `${mode}/${batch}/${wakeMode}: nested callable read`);

    for (const step of steps) {
      runWrite(() => {
        if (mode === 'jsondb') {
          const insertPosition = step.position === 'child' ? 'inside' : step.position;
          store.nestable.page.fields.mutate(
            where('id', '===', step.sourceId),
            moveToMatches('id', '===', step.targetId, insertPosition, insertPosition === 'inside' ? 'fields' : undefined)
          );
          api.setValue('nestable.page.fields', refresh(structuredClone(readFields())));
          return;
        }
        commitFields(moveDirect(readFields(), step.sourceId, step.targetId, step.position));
      });
    }

    const finalFields = readFields();
    assertExpected(finalFields, `${mode}/${batch}/${wakeMode}`);
    assertExpected(store.nestable.page.fields(), `${mode}/${batch}/${wakeMode}: callable read after CMS sequence`);

    runWrite(() => {
      if (mode === 'jsondb') {
        store.nestable.page.fields.mutate(where('id', '===', 'settings'), update('expanded', (value: boolean) => !value));
        api.setValue('nestable.page.fields', refresh(structuredClone(readFields())));
      } else {
        const next = structuredClone(readFields()) as NestableNode[];
        const settings = find(next, 'settings');
        assert(settings, `${mode}/${batch}/${wakeMode}: settings should exist before toggle`);
        settings!.expanded = !settings!.expanded;
        commitFields(refresh(next));
      }
    });

    assert((find(readFields(), 'settings')?.expanded ?? true) === false, `${mode}/${batch}/${wakeMode}: toggle after sequence`);

    const result = {
      mode,
      batch,
      wakeMode,
      rootEffectRuns,
      leafEffectRuns,
      rootOrder: ids(finalFields),
    };
    dispose();
    return result;
  });
}

const results = [
  runScenario('jsondb', false, 'grained'),
  runScenario('jsondb', true, 'grained'),
  runScenario('jsondb', false, 'container'),
  runScenario('jsondb', true, 'container'),
  runScenario('direct', false, 'grained'),
  runScenario('direct', true, 'grained'),
  runScenario('direct', false, 'container'),
  runScenario('direct', true, 'container'),
  runScenario('native', false, 'grained'),
  runScenario('native', true, 'grained'),
  runScenario('native', false, 'container'),
  runScenario('native', true, 'container'),
];

for (const result of results) {
  console.log('solid-nestable-cms-mode:', result);
}

console.log('All solid nestable CMS mode tests passed.');
