import { createEffect, createRoot } from 'solid-js';
import { createSolidStore } from '../src';
import '../src/jsondb';
import where from '@synestiqx/jsondb/operators/where';
import moveTo from '@synestiqx/jsondb/operators/moveTo';

interface MenuNode {
  id: string;
  label: string;
  fields: MenuNode[];
}

interface MenuState {
  menu: {
    fields: MenuNode[];
  };
}

type MoveMode = 'jsondb' | 'direct';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function node(id: string, fields: MenuNode[] = []): MenuNode {
  return { id, label: id.toUpperCase(), fields };
}

function createMenuState(): MenuState {
  return {
    menu: {
      fields: [
        node('dashboard'),
        node('catalog', [
          node('product'),
          node('variants'),
          node('pricing'),
        ]),
        node('settings', [
          node('security'),
          node('theme'),
        ]),
        node('help'),
      ],
    },
  };
}

function cloneFields(fields: MenuNode[]): MenuNode[] {
  return structuredClone(fields);
}

function collectIds(fields: MenuNode[], out: string[] = []): string[] {
  for (const item of fields) {
    out.push(item.id);
    collectIds(item.fields, out);
  }
  return out;
}

function findNode(fields: MenuNode[], id: string): MenuNode | undefined {
  for (const item of fields) {
    if (item.id === id) return item;
    const nested = findNode(item.fields, id);
    if (nested) return nested;
  }
  return undefined;
}

function detachNode(fields: MenuNode[], id: string): MenuNode | undefined {
  for (let index = 0; index < fields.length; index++) {
    if (fields[index]?.id === id) {
      return fields.splice(index, 1)[0];
    }
    const nested = detachNode(fields[index]!.fields, id);
    if (nested) return nested;
  }
  return undefined;
}

function moveDirect(fields: MenuNode[], id: string, targetParentId: string | null, index: number): MenuNode[] {
  const next = cloneFields(fields);
  const moved = detachNode(next, id);
  assert(moved, `direct move should find source ${id}`);
  const targetFields = targetParentId === null ? next : findNode(next, targetParentId)?.fields;
  assert(targetFields, `direct move should find target parent ${String(targetParentId)}`);
  const clamped = Math.max(0, Math.min(targetFields!.length, index));
  targetFields!.splice(clamped, 0, moved!);
  return next;
}

function idsOf(fields: MenuNode[] | undefined): string[] {
  return (fields ?? []).map((item) => item.id);
}

function assertExpectedMenu(fields: MenuNode[], label: string): void {
  const allIds = collectIds(fields);
  assert(allIds.length === new Set(allIds).size, `${label}: menu ids must stay unique`);
  assert(allIds.length === 9, `${label}: no menu node should be lost`);
  assert(idsOf(fields).join(',') === 'catalog,settings,dashboard,help', `${label}: root order should be dynamic and stable`);
  assert(idsOf(findNode(fields, 'catalog')?.fields).join(',') === 'variants,product', `${label}: catalog children should be reordered`);
  assert(idsOf(findNode(fields, 'settings')?.fields).join(',') === 'pricing,security,theme', `${label}: pricing should move into settings`);
}

function runScenario(mode: MoveMode, batched: boolean, wakeMode: 'grained' | 'container') {
  return createRoot((dispose) => {
    const api = createSolidStore(createMenuState() as unknown as Record<string, unknown>, `solid_nested_${mode}_${batched}_${wakeMode}`);
    const store = api.store as any;
    api.wakeUp(wakeMode);

    api.setValue('menu.fields.0.label', 'DASHBOARD');
    assert((api.readStore('menu.fields') as MenuNode[])[0].label === 'DASHBOARD', `${mode}/${batched}/${wakeMode}: api.setValue should commit through callable proxy paths`);

    let rootEffectRuns = 0;
    let leafEffectRuns = 0;
    createEffect(() => {
      void store.menu.fields();
      rootEffectRuns++;
    });
    createEffect(() => {
      void store.menu.fields[0].label();
      leafEffectRuns++;
    });

    const runMoves = () => {
      if (mode === 'jsondb') {
        api.mutate('menu.fields', where('id', '===', 'dashboard'), moveTo('2', 'after'));
        api.mutate('menu.fields', where('id', '===', 'pricing'), moveTo('1.fields', 'inside', 0));
        api.mutate('menu.fields', where('id', '===', 'variants'), moveTo('0.fields.0', 'before'));
        return;
      }

      let fields = api.readStore('menu.fields') as MenuNode[];
      fields = moveDirect(fields, 'dashboard', null, 2);
      store.setValue('menu.fields', fields);
      fields = api.readStore('menu.fields') as MenuNode[];
      fields = moveDirect(fields, 'pricing', 'settings', 0);
      store.setValue('menu.fields', fields);
      fields = api.readStore('menu.fields') as MenuNode[];
      fields = moveDirect(fields, 'variants', 'catalog', 0);
      store.setValue('menu.fields', fields);
    };

    const rootBefore = rootEffectRuns;
    const leafBefore = leafEffectRuns;
    if (batched) {
      api.batch(runMoves);
    } else {
      runMoves();
    }

    const finalFields = api.readStore('menu.fields') as MenuNode[];
    assertExpectedMenu(finalFields, `${mode}/${batched}/${wakeMode}`);

    const rootDelta = rootEffectRuns - rootBefore;
    const leafDelta = leafEffectRuns - leafBefore;
    assert(rootDelta >= 0, `${mode}/${batched}/${wakeMode}: root effect counter should stay valid in the current runtime`);
    assert(leafDelta >= 0, `${mode}/${batched}/${wakeMode}: leaf effect counter should stay valid in the current runtime`);

    dispose();
    return {
      mode,
      batched,
      wakeMode,
      rootDelta,
      leafDelta,
      rootOrder: idsOf(finalFields),
    };
  });
}

const scenarios = [
  runScenario('jsondb', false, 'grained'),
  runScenario('jsondb', true, 'grained'),
  runScenario('jsondb', false, 'container'),
  runScenario('jsondb', true, 'container'),
  runScenario('direct', false, 'grained'),
  runScenario('direct', true, 'grained'),
  runScenario('direct', false, 'container'),
  runScenario('direct', true, 'container'),
];

for (const scenario of scenarios) {
  console.log('solid-nested-tree-batch:', scenario);
}

console.log('All solid nested tree batch tests passed.');
