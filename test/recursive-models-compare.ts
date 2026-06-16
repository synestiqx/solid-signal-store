import { createSolidStore } from '../src';
import {
  RecursiveJsonScenarioFactory,
  RecursivePerfRunner,
  type RecursiveLabState,
} from '../../src/app/store/perf/recursive-json-scenarios';

type BenchRow = {
  label: string;
  iterations: number;
  avgMs: number;
  opsPerSecond: number;
};

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function printRows(rows: BenchRow[]): void {
  console.log('label\titerations\tavgMs\topsPerSecond');
  for (const row of rows) {
    console.log(`${row.label}\t${row.iterations}\t${formatNumber(row.avgMs, 6)}\t${formatNumber(row.opsPerSecond, 0)}`);
  }
}

function benchPathUpdates(
  label: string,
  paths: string[],
  iterations: number,
  write: (path: string, value: string, index: number) => void
): BenchRow {
  const result = RecursivePerfRunner.measure(label, iterations, (index) => {
    const path = paths[index % paths.length];
    write(path, `${label}-${index}`, index);
  });
  return {
    label: result.label,
    iterations: result.iterations,
    avgMs: result.avgMs,
    opsPerSecond: result.opsPerSecond,
  };
}

(() => {
  const depth = 5;
  const breadth = 3;
  const iterations = 5_000;
  const state = RecursiveJsonScenarioFactory.createState({ depth, breadth, prefix: 'solid-bench' });
  const nestedPaths = RecursiveJsonScenarioFactory.collectDataPaths(state.tree);
  const graphPaths = RecursiveJsonScenarioFactory.collectFlatGraphDataPaths(state.flatGraph);
  const comparison = RecursivePerfRunner.compareNestedAndFlat(state.tree, 250);
  const api = createSolidStore(clone(state) as unknown as Record<string, unknown>, 'solid-recursive-models-compare');

  assert(nestedPaths.length === graphPaths.length, 'nested and flat graph path sets should cover the same nodes');
  assert(comparison.nodeCount === nestedPaths.length, 'canonical model comparison should cover every node');

  const rows: BenchRow[] = [
    comparison.nestedTraversal,
    comparison.flatGraphTraversal,
    comparison.graphMaterialize,
    comparison.nestedVersionResolution,
    comparison.flatGraphVersionResolution,
    benchPathUpdates('solid-store-nested-setValue', nestedPaths, iterations, (path, value) => api.setValue(path, value)),
    benchPathUpdates('solid-store-flat-graph-setValue', graphPaths, iterations, (path, value) => api.setValue(path, value)),
  ];

  const graphRows = RecursiveJsonScenarioFactory.flattenRowsFromGraph(state.flatGraph);
  const solidState = api.readStore('') as RecursiveLabState;

  console.log(`solid recursive model benchmark depth=${depth} breadth=${breadth} nodes=${nestedPaths.length}`);
  printRows(rows);
  console.log(`nestedVersionTargets\t${comparison.nestedVersionTargetCount}`);
  console.log(`flatGraphVersionTargets\t${comparison.flatGraphVersionTargetCount}`);
  console.log(`flatGraphToNestedScanRatio\t${formatNumber(comparison.flatToNestedOpsRatio, 3)}`);
  console.log(`flatGraphToNestedVersionRatio\t${formatNumber(comparison.flatToNestedVersionOpsRatio, 3)}`);
  console.log(`graphRows\t${graphRows.length}`);

  assert(rows.every((row) => row.opsPerSecond > 0), 'all Solid recursive model rows should report throughput');
  assert(graphRows.length === nestedPaths.length, 'flat graph rows should cover every generated node');
  assert(typeof solidState.flatGraph.nodesByKey.n0.data === 'string', 'Solid flat graph write should preserve graph node data');
  assert(typeof solidState.tree[0].data === 'string', 'Solid nested write should preserve nested node data');
  console.log('solid-recursive-models-compare: nested fields vs flat graph store benchmark -> OK');
})();
