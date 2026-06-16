import { createRoot } from 'solid-js';
import { createSolidStore, onSolidDevAction } from '../src';

type WakeMode = 'exact' | 'branch';

type Cell = {
  id: string;
  value: number;
  color: string;
  clicks: number;
  renders: number;
  meta: { row: number; col: number; changedAt: number };
};

const COLORS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#ede9fe', '#cffafe'];

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function nextColor(current: string): string {
  const index = COLORS.indexOf(current);
  return COLORS[(index + 1) % COLORS.length];
}

function createBoard(rows = 4, cols = 5) {
  return {
    rows: Array.from({ length: rows }, (_, row) => ({
      id: `row-${row}`,
      cells: Array.from({ length: cols }, (_, col) => ({
        id: `cell-${row}-${col}`,
        value: row * cols + col,
        color: COLORS[(row + col) % COLORS.length],
        clicks: 0,
        renders: 0,
        meta: { row, col, changedAt: 0 },
      })),
    })),
    stats: {
      leftClicks: 0,
      rightClicks: 0,
      lastCellId: '',
      wakeMode: 'exact' as WakeMode,
      batch: true,
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function runScenario(batch: boolean, mode: WakeMode) {
  return createRoot((dispose) => {
    const api = createSolidStore({ board: createBoard() }, `solid_board_${batch}_${mode}`);
    const store = api.store as any;
    const events: any[] = [];
    const unsubscribe = onSolidDevAction((event) => {
      if (event.storeName === `solid_board_${batch}_${mode}`) events.push(event);
    });
    api.enableDevTools(`solid_board_${batch}_${mode}`);

    const writeCell = (row: number, col: number, action: 'left' | 'right') => {
      const cellPath = `board.rows.${row}.cells.${col}`;
      const run = () => {
        const cell = store.board.rows[row].cells[col];
        if (action === 'left') {
          cell.value = cell.value() + 1;
          store.board.stats.leftClicks = store.board.stats.leftClicks() + 1;
        } else {
          cell.color = nextColor(cell.color());
          store.board.stats.rightClicks = store.board.stats.rightClicks() + 1;
        }
        cell.clicks = cell.clicks() + 1;
        cell.renders = cell.renders() + 1;
        cell.meta.changedAt = Date.now();
        store.board.stats.lastCellId = cell.id();
        store.board.stats.wakeMode = mode;
        store.board.stats.batch = batch;
        api.wakeUp(`${cellPath}.${action === 'left' ? 'value' : 'color'}`, mode === 'branch' ? 'leaf' : 'grained');
      };
      if (batch) api.batch(run);
      else run();
    };

    const beforeValue = store.board.rows[1].cells[2].value();
    writeCell(1, 2, 'left');
    assert(store.board.rows[1].cells[2].value() === beforeValue + 1, `${batch}/${mode}: left increments value`);
    assert(store.board.rows[1].cells[2].clicks() === 1, `${batch}/${mode}: left increments cell clicks`);
    assert(store.board.stats.leftClicks() === 1, `${batch}/${mode}: left increments stats`);

    const beforeColor = store.board.rows[2].cells[3].color();
    writeCell(2, 3, 'right');
    assert(store.board.rows[2].cells[3].color() === nextColor(beforeColor), `${batch}/${mode}: right changes color`);
    assert(store.board.rows[2].cells[3].clicks() === 1, `${batch}/${mode}: right increments cell clicks`);
    assert(store.board.stats.rightClicks() === 1, `${batch}/${mode}: right increments stats`);
    assert(store.board.stats.wakeMode() === mode, `${batch}/${mode}: mode stored`);
    assert(store.board.stats.lastCellId() === 'cell-2-3', `${batch}/${mode}: last cell stored`);

    return { dispose, unsubscribe, events };
  });
}

const scenarios = [
  runScenario(false, 'exact'),
  runScenario(true, 'exact'),
  runScenario(false, 'branch'),
  runScenario(true, 'branch'),
];

await flush();

for (const scenario of scenarios) {
  assert(scenario.events.some((event) => event.type === 'SET_VALUE'), 'dev SET_VALUE emitted');
  const badPath = scenario.events
    .map((event) => String(event.payload?.path ?? ''))
    .find((path) => /\.(click|contextmenu|left|right)(\.|$)/.test(path));
  assert(!badPath, `UI method names should not leak into paths, got ${badPath}`);
  scenario.unsubscribe();
  scenario.dispose();
}

console.log('All solid store board wakeup contract tests passed.');
