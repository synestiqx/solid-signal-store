import { createSolidStore, waitForStore } from '../src';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const pending = waitForStore<{ ready: boolean }>('async-store', { timeoutMs: 500 });
queueMicrotask(() => createSolidStore({ ready: true }, 'async-store'));
const api = await pending;
assert(api.store.ready() === true, 'wait resolves with lazily created store');

const immediate = await waitForStore<{ ready: boolean }>('async-store');
assert(immediate === api, 'existing store resolves immediately');

let timedOut = false;
try {
  await waitForStore('missing-store', { timeoutMs: 0 });
} catch (error) {
  timedOut = String(error).includes('timed out');
}
assert(timedOut, 'timeout rejects and cleans up waiter');

const controller = new AbortController();
const aborted = waitForStore('aborted-store', { signal: controller.signal });
controller.abort();
let abortName = '';
try { await aborted; } catch (error) { abortName = (error as Error).name; }
assert(abortName === 'AbortError', 'abort signal rejects with AbortError');

api.destroy();
console.log('Solid waitForStore contract passed.');
