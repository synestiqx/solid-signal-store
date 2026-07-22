/**
 * High-performance fixed-capacity ring (circular) buffer.
 * O(1) push/overwrite, bounded memory, no unbounded allocations on hot path.
 * Useful for logs, event streams, temporary result windows, etc.
 *
 * Designed for the performance-sensitive parts of store-solid (demo logs, potential bridge collectors, etc.).
 * Snapshot via toArray() only when needed (avoids paying for iteration in every push).
 */
export declare class RingBuffer<T> {
    private readonly buffer;
    private readonly capacity;
    private head;
    private length;
    constructor(capacity: number);
    get size(): number;
    get isFull(): boolean;
    get isEmpty(): boolean;
    /** Push item. Overwrites oldest when full (O(1)). */
    push(item: T): void;
    /** Remove and return oldest item, or undefined if empty. */
    pop(): T | undefined;
    /** Peek oldest without removing. */
    peek(): T | undefined;
    /** Clear all elements (O(1) logical, O(capacity) to help GC if desired). */
    clear(): void;
    /**
     * Returns a snapshot array in insertion order (oldest first).
     * This allocates — call only when you actually need the array (e.g. for rendering logs).
     */
    toArray(): T[];
    /** Iterate in insertion order without extra allocation (generator). */
    [Symbol.iterator](): IterableIterator<T>;
    /** Debug helper */
    toString(): string;
}
export type { RingBuffer as IRingBuffer };
