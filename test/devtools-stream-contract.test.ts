import { createSolidDevtools } from '../src/devtools';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const devtools = createSolidDevtools();
devtools.emitAction({ type: 'FIRST', payload: { value: 1 } });

const replayed: string[] = [];
const subscription = devtools.action$.subscribe((event) => replayed.push(event.type));
assert(JSON.stringify(replayed) === JSON.stringify(['FIRST']), 'late subscriber receives current value');

devtools.emitAction({ type: 'SECOND' });
assert(JSON.stringify(replayed) === JSON.stringify(['FIRST', 'SECOND']), 'subscriber receives later value');

subscription.unsubscribe();
devtools.emitAction({ type: 'THIRD' });
assert(replayed.length === 2, 'unsubscribe detaches listener');

devtools.destroy();
assert(devtools.action$.get() === null, 'destroy clears current value');

console.log('Solid devtools stream contract passed.');
