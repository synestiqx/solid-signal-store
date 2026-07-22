/**
 * High-performance fixed-capacity ring (circular) buffer.
 * O(1) push/overwrite, bounded memory, no unbounded allocations on hot path.
 * Useful for logs, event streams, temporary result windows, etc.
 *
 * Designed for the performance-sensitive parts of store-solid (demo logs, potential bridge collectors, etc.).
 * Snapshot via toArray() only when needed (avoids paying for iteration in every push).
 */
export class RingBuffer {
    buffer;
    capacity;
    head = 0; // index of oldest element
    length = 0; // current number of elements
    constructor(capacity) {
        if (capacity <= 0 || !Number.isFinite(capacity)) {
            throw new Error(`RingBuffer capacity must be positive finite, got ${capacity}`);
        }
        this.capacity = Math.floor(capacity);
        this.buffer = new Array(this.capacity);
    }
    get size() {
        return this.length;
    }
    get isFull() {
        return this.length === this.capacity;
    }
    get isEmpty() {
        return this.length === 0;
    }
    /** Push item. Overwrites oldest when full (O(1)). */
    push(item) {
        const idx = (this.head + this.length) % this.capacity;
        this.buffer[idx] = item;
        if (this.length < this.capacity) {
            this.length++;
        }
        else {
            // buffer was full → we overwrote the oldest
            this.head = (this.head + 1) % this.capacity;
        }
    }
    /** Remove and return oldest item, or undefined if empty. */
    pop() {
        if (this.length === 0)
            return undefined;
        const item = this.buffer[this.head];
        this.buffer[this.head] = undefined; // help GC
        this.head = (this.head + 1) % this.capacity;
        this.length--;
        return item;
    }
    /** Peek oldest without removing. */
    peek() {
        if (this.length === 0)
            return undefined;
        return this.buffer[this.head];
    }
    /** Clear all elements (O(1) logical, O(capacity) to help GC if desired). */
    clear() {
        // Best-effort GC help without extra allocation
        for (let i = 0; i < this.length; i++) {
            const idx = (this.head + i) % this.capacity;
            this.buffer[idx] = undefined;
        }
        this.head = 0;
        this.length = 0;
    }
    /**
     * Returns a snapshot array in insertion order (oldest first).
     * This allocates — call only when you actually need the array (e.g. for rendering logs).
     */
    toArray() {
        const result = new Array(this.length);
        for (let i = 0; i < this.length; i++) {
            result[i] = this.buffer[(this.head + i) % this.capacity];
        }
        return result;
    }
    /** Iterate in insertion order without extra allocation (generator). */
    *[Symbol.iterator]() {
        for (let i = 0; i < this.length; i++) {
            yield this.buffer[(this.head + i) % this.capacity];
        }
    }
    /** Debug helper */
    toString() {
        return `RingBuffer(cap=${this.capacity}, len=${this.length})`;
    }
}
//# sourceMappingURL=ring-buffer.js.map