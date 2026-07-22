import { createSolidStore } from 'solid-signal-store';
import 'solid-signal-store/jsnq';
import where from 'jsnq/operators/where';
import update from 'jsnq/operators/update';
import deleteKey from 'jsnq/operators/deleteKey';

type BenchResult = {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  ops: number;
  ok: boolean;
  detail: string;
};

type Row = {
  id: number;
  active: boolean;
  val: number;
  label?: string;
  touched?: boolean;
};

const resultsEl = document.getElementById('results')!;
const rawEl = document.getElementById('raw')!;

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    active: i % 3 === 0,
    val: i % 100,
    label: `R${i}`,
    touched: false,
  }));
}

function makeDeep() {
  return { a: { b: { c: { d: { value: 42, updated: false } } } } };
}

const api = createSolidStore(
  {
    flat: makeRows(5000),
    deleteRows: makeRows(10000),
    deep: makeDeep(),
  },
  'jsnq-browser-bench'
);
const store = api.store as any;

function timeCase(
  name: string,
  iterations: number,
  setup: () => void,
  run: () => void,
  verify: () => { ok: boolean; detail: string }
): BenchResult {
  const start = performance.now();
  let final = { ok: false, detail: 'not-run' };

  for (let i = 0; i < iterations; i++) {
    setup();
    const caseStart = performance.now();
    run();
    const elapsed = performance.now() - caseStart;
    if (!Number.isFinite(elapsed)) throw new Error(`${name}: invalid timing`);
    final = verify();
    if (!final.ok) break;
  }

  const totalMs = +(performance.now() - start).toFixed(3);
  const avgMs = +(totalMs / iterations).toFixed(3);
  const ops = avgMs > 0 ? Math.round(1000 / avgMs) : Number.POSITIVE_INFINITY;
  return { name, iterations, totalMs, avgMs, ops, ok: final.ok, detail: final.detail };
}

function render(results: BenchResult[]): void {
  const rows = results.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.iterations}</td>
      <td>${r.totalMs.toFixed(3)}ms</td>
      <td>${r.avgMs.toFixed(3)}ms</td>
      <td>${Number.isFinite(r.ops) ? r.ops : '∞'}</td>
      <td class="${r.ok ? 'ok' : 'fail'}">${r.ok ? 'OK' : 'FAIL'}</td>
      <td>${r.detail}</td>
    </tr>
  `).join('');

  resultsEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>case</th>
          <th>iterations</th>
          <th>total</th>
          <th>avg</th>
          <th>ops/s</th>
          <th>status</th>
          <th>detail</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  rawEl.textContent = JSON.stringify(results, null, 2);
}

function runBench(): BenchResult[] {
  const results = [
    timeCase(
      'flat-where-update-5000-real-store',
      20,
      () => { store.flat = makeRows(5000); },
      () => { store.flat.mutate(where('active', '==', true), update({ touched: true, active: false })); },
      () => {
        const data = store.flat();
        const touched = data.filter((x: Row) => x.touched).length;
        const active = data.filter((x: Row) => x.active).length;
        return { ok: touched > 1500 && active === 0, detail: `touched=${touched}, active=${active}` };
      }
    ),
    timeCase(
      'flat-deleteKey-10000-real-store',
      12,
      () => { store.deleteRows = makeRows(10000); },
      () => { store.deleteRows.mutate(where('val', '<', 100), deleteKey('label')); },
      () => {
        const data = store.deleteRows();
        const noLabel = data.filter((x: Row) => !('label' in x)).length;
        return { ok: noLabel === 10000, detail: `noLabel=${noLabel}` };
      }
    ),
    timeCase(
      'deep-standard-update-real-store',
      80,
      () => { store.deep = makeDeep(); },
      () => { store.deep.mutate(where('a.b.c.d.value', '==', 42), update('a.b.c.d.updated', true)); },
      () => {
        const updated = store.deep().a.b.c.d.updated === true;
        return { ok: updated, detail: `updated=${updated}` };
      }
    ),
  ];

  return results;
}

try {
  console.log('Starting real jsnq browser benchmark...');
  const results = runBench();
  for (const r of results) {
    console.log(`${r.name}: total=${r.totalMs}ms avg=${r.avgMs}ms ops=${r.ops} ok=${r.ok} ${r.detail}`);
  }
  render(results);
  (window as any).__JSNQ_BENCH_RESULTS = results;
  document.title = results.every((r) => r.ok) ? 'jsnq-bench-complete' : 'jsnq-bench-failed';
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('jsnq browser benchmark failed:', message);
  resultsEl.innerHTML = `<div class="fail">${message}</div>`;
  (window as any).__JSNQ_BENCH_ERROR = message;
  document.title = 'jsnq-bench-failed';
}
