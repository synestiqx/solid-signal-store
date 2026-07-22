export interface ArrayMutator {
    read(path: string): unknown;
    commit(path: string, value: unknown): void;
    batch(fn: () => void): void;
}
type Predicate<T> = (item: T, index: number, arr: T[]) => boolean;
type Mapper<T, R> = (item: T, index: number, arr: T[]) => R;
type Reducer<T, R> = (acc: R, item: T, index: number, arr: T[]) => R;
export declare class ArrayChain {
    private readonly p;
    private readonly m;
    constructor(p: string, m: ArrayMutator);
    push(...v: any[]): this;
    unshift(...v: any[]): this;
    pop(): this;
    shift(): this;
    reverse(): this;
    sort(fn?: (x: any, y: any) => number): this;
    splice(start: number, del?: number, ...items: any[]): this;
    update(i: number, val: any): this;
    updateByFind(pred: any | Predicate<any>, val: any): this;
    delete(pred: any | Predicate<any>): this;
    deleteByIndex(i: number): this;
    find(pred: any | Predicate<any>): any | undefined;
    findIndex(pred: any | Predicate<any>): number;
    filter(pred: any): ArrayChain;
    map<R>(fn: Mapper<any, R>): R[];
    reduce<R>(fn: Reducer<any, R>, init: R): R;
    some(pred: Predicate<any> | any): boolean;
    every(pred: Predicate<any> | any): boolean;
    includes(v: any): boolean;
    indexOf(v: any): number;
    length(): number;
}
export declare const ARRAY_QUERY_METHODS: Set<string>;
export declare const ARRAY_MUTATION_METHODS: Set<string>;
export declare const ARRAY_METHODS: Set<string>;
export declare function applyArrayMutation(arr: any[], method: string, args?: unknown[]): any;
export declare function executeArrayOperation(path: string, method: string, args: unknown[] | undefined, mut: ArrayMutator): unknown;
export declare function createArrayChain(path: string, mutator: ArrayMutator): ArrayChain;
export {};
