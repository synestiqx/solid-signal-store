// solid-array.ts — Fluent ArrayChain + direct array operations.
// Narrow ArrayMutator (read + commit + batch) injected by orchestrator (SolidStore).
// Delivers full fluent API parity + direct method semantics (different return values).
// Zero duplication of proxy/SolidStore logic. Queries use native on snapshot.
// Mutations always COW + batch + commit. Predicate-or-value sugar only in fluent.
// Clean, small, per PLAN.md v2 (hardened) + Critic rules. Single source for arrays.

export interface ArrayMutator {
  read(path: string): unknown;
  commit(path: string, value: unknown): void;
  batch(fn: () => void): void;
}

type Predicate<T> = (item: T, index: number, arr: T[]) => boolean;
type Mapper<T, R> = (item: T, index: number, arr: T[]) => R;
type Reducer<T, R> = (acc: R, item: T, index: number, arr: T[]) => R;

function asPredicate<T>(v: Predicate<T> | T): Predicate<T> {
  return typeof v === 'function' ? (v as Predicate<T>) : (item: T) => item === v;
}

function readArr(mut: ArrayMutator, p: string): any[] | undefined {
  const v = mut.read(p ?? '');
  return Array.isArray(v) ? v : undefined;
}

function mutate<R>(mut: ArrayMutator, p: string, op: (a: any[]) => R): R {
  const cur = readArr(mut, p) ?? [];
  const copy = [...cur];
  const r = op(copy);
  mut.batch(() => mut.commit(p, copy));
  return r;
}

export class ArrayChain {
  constructor(private readonly p: string, private readonly m: ArrayMutator) {}

  // === Mutations (chainable; native return values swallowed for fluency) ===
  push(...v: any[]): this { if (v.length) mutate(this.m, this.p, a => { v.length === 1 ? a.push(v[0]) : a.push(...v); }); return this; }
  unshift(...v: any[]): this { if (v.length) mutate(this.m, this.p, a => { v.length === 1 ? a.unshift(v[0]) : a.unshift(...v); }); return this; }
  pop(): this { mutate(this.m, this.p, a => void a.pop()); return this; }
  shift(): this { mutate(this.m, this.p, a => void a.shift()); return this; }
  reverse(): this { mutate(this.m, this.p, a => void a.reverse()); return this; }
  sort(fn?: (x: any, y: any) => number): this { mutate(this.m, this.p, a => void a.sort(fn)); return this; }
  splice(start: number, del = 0, ...items: any[]): this { mutate(this.m, this.p, a => void a.splice(start, del, ...items)); return this; }

  update(i: number, val: any): this {
    mutate(this.m, this.p, a => {
      if (i < 0 || i >= a.length) throw new Error(`Index ${i} out of bounds for ${this.p}`);
      a[i] = val;
    });
    return this;
  }
  updateByFind(pred: any | Predicate<any>, val: any): this {
    const f = asPredicate(pred);
    mutate(this.m, this.p, a => { const i = a.findIndex(f); if (i !== -1) a[i] = val; });
    return this;
  }
  delete(pred: any | Predicate<any>): this {
    const f = asPredicate(pred);
    mutate(this.m, this.p, a => { for (let i = a.length - 1; i >= 0; i--) if (f(a[i], i, a)) a.splice(i, 1); });
    return this;
  }
  deleteByIndex(i: number): this {
    mutate(this.m, this.p, a => { if (i >= 0 && i < a.length) a.splice(i, 1); });
    return this;
  }

  // === Queries (immediate; sugar for predicate|value on find*/delete*/updateByFind/some/every) ===
  find(pred: any | Predicate<any>): any | undefined { return (readArr(this.m, this.p) ?? []).find(asPredicate(pred)); }
  findIndex(pred: any | Predicate<any>): number { return (readArr(this.m, this.p) ?? []).findIndex(asPredicate(pred)); }
  filter(pred: any): ArrayChain {
    const predicate = typeof pred === 'function' ? pred : asPredicate(pred);

    // Return a lightweight chain that applies mutations to all matching items
    const parentPath = this.p;
    const parentMut = this.m;

    const filtered = new ArrayChain(parentPath, parentMut);

    // Override key mutation methods to operate on filtered items
    filtered.update = (i: number, val: any) => {
      mutate(parentMut, parentPath, (a) => {
        let matchCount = 0;
        for (let idx = 0; idx < a.length; idx++) {
          if (predicate(a[idx], idx, a)) {
            if (matchCount === i) {
              a[idx] = val;
              break;
            }
            matchCount++;
          }
        }
      });
      return filtered;
    };

    filtered.delete = () => {
      mutate(parentMut, parentPath, (a) => {
        for (let i = a.length - 1; i >= 0; i--) {
          if (predicate(a[i], i, a)) a.splice(i, 1);
        }
      });
      return filtered;
    };

    // For updateByFind on filtered, etc. — keep simple for now
    return filtered;
  }
  map<R>(fn: Mapper<any, R>): R[] { return (readArr(this.m, this.p) ?? []).map(fn as any); }
  reduce<R>(fn: Reducer<any, R>, init: R): R { return (readArr(this.m, this.p) ?? []).reduce(fn as any, init); }
  some(pred: Predicate<any> | any): boolean {
    const a = readArr(this.m, this.p) ?? []; const f = typeof pred === 'function' ? pred : asPredicate(pred); return a.some(f);
  }
  every(pred: Predicate<any> | any): boolean {
    const a = readArr(this.m, this.p) ?? []; const f = typeof pred === 'function' ? pred : asPredicate(pred); return a.every(f);
  }
  includes(v: any): boolean { return (readArr(this.m, this.p) ?? []).includes(v); }
  indexOf(v: any): number { return (readArr(this.m, this.p) ?? []).indexOf(v); }
  length(): number { return (readArr(this.m, this.p) ?? []).length; }
}

// Shared array method classification (single source — eliminates duplication with SolidStore.arrayOp)
export const ARRAY_QUERY_METHODS = new Set([
  'filter', 'map', 'find', 'findIndex', 'some', 'every', 'includes', 'indexOf', 'length'
]);
export const ARRAY_MUTATION_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'
]);
export const ARRAY_METHODS = new Set([
  ...ARRAY_QUERY_METHODS,
  ...ARRAY_MUTATION_METHODS,
]);

// Pure dispatch table for mutations. This is the "maximally dispatch" style the user wants.
// Each entry is a tiny named handler. No switch/if cascades in the hot path.
// Async/batch safety is preserved because the caller (mutate helper) always wraps the result in batch+commit.
const ARRAY_MUTATION_HANDLERS: Record<string, (arr: any[], args: unknown[]) => any> = {
  push:    (a, args) => args.length === 1 ? a.push(args[0]) : a.push(...(args as any[])),
  pop:     (a) => a.pop(),
  shift:   (a) => a.shift(),
  unshift: (a, args) => args.length === 1 ? a.unshift(args[0]) : a.unshift(...(args as any[])),
  splice:  (a, args) => {
    const start = Number(args[0] ?? 0);
    if (args.length === 1) return a.splice(start);
    return a.splice(start, Number(args[1] ?? 0), ...(args.slice(2) as any[]));
  },
  sort:    (a, args) => a.sort(args[0] as any),
  reverse: (a) => a.reverse(),
};

export function applyArrayMutation(arr: any[], method: string, args: unknown[] = []): any {
  const handler = ARRAY_MUTATION_HANDLERS[method];
  if (handler) return handler(arr, args);
  const f = (arr as any)[method];
  return typeof f === 'function' ? f.apply(arr, args) : undefined;
}

// Direct array operations (for proxy traps store.arr.push etc + SolidStore.arrayOp delegation).
// Preserves native return semantics (push→length, pop→removed, splice→removed[] ...).
// Query paths are zero-copy. No dev emit here (proxy owns it).
export function executeArrayOperation(path: string, method: string, args: unknown[] = [], mut: ArrayMutator): unknown {
  const cur = readArr(mut, path);
  if (!cur) {
    if (method === 'length') return 0;
    if (method === 'filter' || method === 'map') return [];
    return undefined;
  }
  if (ARRAY_QUERY_METHODS.has(method)) {
    if (method === 'length') return cur.length;
    // direct: pass args verbatim (no predicate sugar; caller must use fn for find/filter etc)
    return (cur as any)[method](...(args as any[]));
  }
  // mutate via COW helper + pure dispatch table (no switch/if in this layer)
  return mutate(mut, path, (a) => applyArrayMutation(a, method, args));
}

export function createArrayChain(path: string, mutator: ArrayMutator): ArrayChain {
  return new ArrayChain(path, mutator);
}
