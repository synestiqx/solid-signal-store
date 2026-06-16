import { createMemo, createRoot } from 'solid-js';
import { createSolidStore } from '../src';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function createState() {
  return {
    menu: {
      fields: [
        { id: 'dashboard', label: 'Dashboard', fields: [] as unknown[] },
        { id: 'settings', label: 'Settings', fields: [] as unknown[] },
      ],
    },
  };
}

function runWakeScenario(mode: 'grained' | 'container') {
  return createRoot((dispose) => {
    const api = createSolidStore(createState(), `solid_wakeup_${mode}`);
    const store = api.store as any;
    api.wakeUp(mode);

    let leafRuns = 0;
    let parentRuns = 0;
    const leaf = createMemo(() => {
      leafRuns++;
      return store.menu.fields[0].label();
    });
    const parent = createMemo(() => {
      parentRuns++;
      return store.menu.fields();
    });

    assert(leaf() === 'Dashboard', `${mode}: initial leaf`);
    assert(Array.isArray(parent()), `${mode}: initial parent`);
    const initialLeafRuns = leafRuns;
    const initialParentRuns = parentRuns;

    store.menu.fields[0].label = `${mode}-updated`;

    assert(leaf() === `${mode}-updated`, `${mode}: leaf memo should update`);
    parent();

    const leafDelta = leafRuns - initialLeafRuns;
    const parentDelta = parentRuns - initialParentRuns;
    assert(leafDelta === 1, `${mode}: exact leaf should recompute once, got ${leafDelta}`);
    if (mode === 'grained') {
      assert(parentDelta === 0, `${mode}: parent memo should not be dirtied by leaf change, got ${parentDelta}`);
    } else {
      assert(parentDelta === 1, `${mode}: parent memo should be dirtied by leaf change, got ${parentDelta}`);
    }

    dispose();
    return { mode, leafDelta, parentDelta };
  });
}

function runBatchScenario() {
  return createRoot((dispose) => {
    const api = createSolidStore(createState(), 'solid_batch_reactivity');
    const store = api.store as any;
    let firstRuns = 0;
    let secondRuns = 0;
    const first = createMemo(() => {
      firstRuns++;
      return store.menu.fields[0].label();
    });
    const second = createMemo(() => {
      secondRuns++;
      return store.menu.fields[1].label();
    });

    assert(first() === 'Dashboard', 'batch: initial first');
    assert(second() === 'Settings', 'batch: initial second');
    const firstBefore = firstRuns;
    const secondBefore = secondRuns;

    api.batch(() => {
      store.menu.fields[0].label = 'Dash';
      store.menu.fields[1].label = 'Set';
    });

    assert(first() === 'Dash', 'batch: first value');
    assert(second() === 'Set', 'batch: second value');
    assert(firstRuns - firstBefore === 1, `batch: first memo recompute count ${firstRuns - firstBefore}`);
    assert(secondRuns - secondBefore === 1, `batch: second memo recompute count ${secondRuns - secondBefore}`);

    dispose();
    return {
      firstDelta: firstRuns - firstBefore,
      secondDelta: secondRuns - secondBefore,
    };
  });
}

function runTargetedWakeScenario(mode: 'grained' | 'leaf') {
  return createRoot((dispose) => {
    const api = createSolidStore(createState(), `solid_targeted_wakeup_${mode}`);
    const store = api.store as any;
    api.wakeUp('grained');

    let leafRuns = 0;
    let parentRuns = 0;
    const leaf = createMemo(() => {
      leafRuns++;
      return store.menu.fields[0].label();
    });
    const parent = createMemo(() => {
      parentRuns++;
      return store.menu.fields();
    });

    assert(leaf() === 'Dashboard', `${mode}: targeted initial leaf`);
    assert(Array.isArray(parent()), `${mode}: targeted initial parent`);
    const initialLeafRuns = leafRuns;
    const initialParentRuns = parentRuns;

    store.menu.fields[0].label = `${mode}-targeted`;
    api.wakeUp('menu.fields.0.label', mode);

    assert(leaf() === `${mode}-targeted`, `${mode}: targeted leaf memo should update`);
    parent();

    const leafDelta = leafRuns - initialLeafRuns;
    const parentDelta = parentRuns - initialParentRuns;
    assert(leafDelta === 1, `${mode}: targeted leaf recompute count ${leafDelta}`);
    if (mode === 'grained') {
      assert(parentDelta === 0, `${mode}: targeted parent should not be dirtied, got ${parentDelta}`);
    } else {
      assert(parentDelta === 1, `${mode}: targeted parent should be dirtied, got ${parentDelta}`);
    }

    dispose();
    return { mode, leafDelta, parentDelta };
  });
}

function runBranchMutationScenario() {
  return createRoot((dispose) => {
    const api = createSolidStore(createState(), 'solid_branch_mutation_wakeup');
    const store = api.store as any;
    api.wakeUp('grained');

    const heldField = store.menu.fields[0];
    const heldLabel = store.menu.fields[0].label;
    let heldLabelRuns = 0;
    const heldLabelMemo = createMemo(() => {
      heldLabelRuns++;
      return heldLabel();
    });

    assert(heldLabelMemo() === 'Dashboard', 'branch: initial held child label');
    const beforeReplaceRuns = heldLabelRuns;

    store.menu.fields[0] = { id: 'dashboard-next', label: 'Dashboard Next', fields: [] };
    assert(heldField.label() === 'Dashboard Next', 'branch: held parent proxy follows replaced object');
    assert(heldLabelMemo() === 'Dashboard Next', 'branch: held child proxy wakes after object replacement');
    assert(heldLabelRuns - beforeReplaceRuns === 1, `branch: replacement should wake held child once, got ${heldLabelRuns - beforeReplaceRuns}`);

    const beforeDeleteRuns = heldLabelRuns;
    delete store.menu.fields[0];
    assert(heldLabelMemo() === 'Settings', 'branch: held child proxy follows spliced array item after delete');
    assert(heldLabelRuns - beforeDeleteRuns === 1, `branch: delete should wake held child once, got ${heldLabelRuns - beforeDeleteRuns}`);

    dispose();
    return { replacementDelta: 1, deleteDelta: 1 };
  });
}

const grained = runWakeScenario('grained');
const container = runWakeScenario('container');
const batch = runBatchScenario();
const targetedGrained = runTargetedWakeScenario('grained');
const targetedLeaf = runTargetedWakeScenario('leaf');
const branchMutation = runBranchMutationScenario();

console.log('solid-wakeup-reactivity:', grained);
console.log('solid-wakeup-reactivity:', container);
console.log('solid-batch-reactivity:', batch);
console.log('solid-targeted-wakeup:', targetedGrained);
console.log('solid-targeted-wakeup:', targetedLeaf);
console.log('solid-branch-mutation-wakeup:', branchMutation);
console.log('All solid wakeup/batch reactivity tests passed.');
