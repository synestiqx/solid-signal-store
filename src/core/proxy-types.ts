export type StorePrimitive = string | number | boolean | bigint | symbol | null | undefined;

// opinia5: shared shapes for the $-namespace (subscriptions + reactive jsondb reads).
export type StoreSubscription = { unsubscribe(): void; dispose(): void };

export type StoreSubscribeOptions<T> = {
  equals?: (a: T, b: T) => boolean;
  immediate?: boolean;
  onError?: (error: unknown) => void;
};

export type StoreLiveQuery<T> = (() => T) & {
  subscribe(cb: (value: T) => void, options?: StoreSubscribeOptions<T>): StoreSubscription;
  dispose(): void;
};

export type StoreLeaf<T> = (() => T) & {
  readonly $val: T;
  readonly $signal: () => T;
  toJSON(): T;
  valueOf(): T;
  // opinia5: $-prefixed system surface — present on every node, never collides with data keys.
  $subscribe(cb: (value: T) => void, options?: StoreSubscribeOptions<T>): StoreSubscription;
  $query(...ops: unknown[]): unknown[];
  $queryOne(...ops: unknown[]): unknown;
  $liveQuery(...ops: unknown[]): StoreLiveQuery<unknown[]>;
  $liveQueryOne(...ops: unknown[]): StoreLiveQuery<unknown>;
  $mutate(...ops: unknown[]): unknown;
  $pipe(...ops: unknown[]): unknown;
  $array(): unknown;
};

export type StoreArray<T> = StoreLeaf<T[]> & {
  readonly length: number;
  [index: number]: SolidStoreProxy<T>;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  sort(compareFn?: (a: T, b: T) => number): SolidStoreProxy<T[]>;
  reverse(): SolidStoreProxy<T[]>;
  find(predicate: (item: T, index: number, array: T[]) => boolean): StoreLeaf<T | undefined>;
  findIndex(predicate: (item: T, index: number, array: T[]) => boolean): StoreLeaf<number>;
  filter(predicate: (item: T, index: number, array: T[]) => boolean): T[];
  map<R>(callback: (item: T, index: number, array: T[]) => R): R[];
  some(predicate: (item: T, index: number, array: T[]) => boolean): StoreLeaf<boolean>;
  every(predicate: (item: T, index: number, array: T[]) => boolean): StoreLeaf<boolean>;
  includes(value: T): boolean;
  indexOf(value: T): number;
  mutate(...ops: unknown[]): unknown;
  pipe(...ops: unknown[]): unknown;
  array(): unknown;
};

export type SolidStoreProxy<T> =
  T extends StorePrimitive
    ? StoreLeaf<T>
    : T extends Array<infer U>
      ? StoreArray<U>
      : StoreLeaf<T> & {
          [K in keyof T]: SolidStoreProxy<T[K]>;
        };
