/**
 * splice-precise-bench.ts — quantifies the opinia6 unify win.
 *
 * Large observed array; splice in the MIDDLE. Generic path wakes (reads+equality-checks) every
 * observed descendant signal; precise path (preciseMutationWake) touches only index >= start,
 * skipping the untouched [0,start) prefix. Observably identical (equality masks unchanged leaves);
 * the delta is pure wake WORK. Correctness is asserted in array-splice-precise-wake.test.ts.
 *
 * Run: bun --conditions browser test/splice-precise-bench.ts
 */
import { createRoot } from 'solid-js';
import { createSolidStore } from '../src';

const N = 4000;
const ITERS = 300;
const START = N >> 1; // middle splice — half the signals are an untouchable prefix

const makeArr = () => Array.from({ length: N }, (_, i) => ({ id: i, name: 'u' + i }));

function run(precise: boolean): number {
  let ms = 0;
  createRoot((dispose) => {
    const api = createSolidStore({ users: makeArr() } as any, `bench_${precise ? 'p' : 'g'}`, { preciseMutationWake: precise });
    const store = api.store as any;
    // Materialize a signal for every element leaf so the wake actually has work to do.
    for (let i = 0; i < N; i++) void store.users[i].name();
    // Warm-up
    for (let k = 0; k < 20; k++) { store.users.splice(START, 0, { id: -1, name: 'x' }); store.users.splice(START, 1); }
    const t0 = performance.now();
    for (let k = 0; k < ITERS; k++) {
      store.users.splice(START, 0, { id: -1, name: 'x' }); // insert at middle (start>0 → precise-eligible)
      store.users.splice(START, 1);                        // remove to restore length
    }
    ms = performance.now() - t0;
    api.destroy();
    dispose();
  });
  return ms;
}

// Interleave a few rounds to dampen JIT/GC noise; report the best (min) of each.
let bestG = Infinity, bestP = Infinity;
for (let r = 0; r < 3; r++) {
  bestG = Math.min(bestG, run(false));
  bestP = Math.min(bestP, run(true));
}
const perOpG = bestG / (ITERS * 2);
const perOpP = bestP / (ITERS * 2);
console.log(`=== splice (middle, N=${N}, ${ITERS * 2} ops/round) ===`);
console.log(`generic  (preciseMutationWake=false): ${bestG.toFixed(2)} ms  (${perOpG.toFixed(4)} ms/op)`);
console.log(`precise  (preciseMutationWake=true) : ${bestP.toFixed(2)} ms  (${perOpP.toFixed(4)} ms/op)`);
console.log(`speedup: ${(bestG / bestP).toFixed(2)}x  (precise skips the [0,${START}) prefix wake work)`);
