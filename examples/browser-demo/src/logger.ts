/**
 * DemoLogger — a small, polished, extractable logging utility.
 *
 * Designed for the store-solid browser verification demo, but intentionally
 * built so it can later be published as a tiny standalone package
 * (e.g. "solid-demo-logger" or "granular-logger") for other Solid apps.
 *
 * Features:
 * - Structured logging with levels + categories
 * - Built-in metrics / tracking (counts per level & category)
 * - Pluggable sinks (console, Solid signal for UI, future: remote, file, etc.)
 * - Timing helper for performance measurements
 * - Real RingBuffer for last N entries (O(1) append, bounded memory)
 * - Clean class-based API (easy to instantiate per demo/store)
 */

import { RingBuffer } from 'store-solid/utils/ring-buffer'; // real O(1) ring buffer via demo Vite alias (unblocks Playwright runs)

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Structured log entry. Designed to be stable for extraction.
 * Demo-specific channels (e.g. 'jsondb', 'dev') are carried in the `channel` field.
 */
export interface LogEntry {
  id: string;                    // stable correlation id
  timestamp: string;             // ISO 8601
  hrTime: number;                // performance.now() for high-res timing
  level: LogLevel;
  channel?: string;              // e.g. 'jsondb', 'dev', 'perf', 'bridge'
  message: string;
  data?: unknown;
  tags?: Record<string, string | number | boolean>;
  error?: { message: string; stack?: string; cause?: unknown };
  durationMs?: number;
}

export interface LoggerSink {
  write(entry: LogEntry): void;
}

export interface DemoLoggerOptions {
  maxEntries?: number;
  defaultChannel?: string;       // e.g. 'demo', 'jsondb'
  sinks?: LoggerSink[];
  clock?: () => number;          // injectable high-res time for tests
}

export class DemoLogger {
  private entries: RingBuffer<LogEntry>;
  private counters = new Map<string, number>();
  private sinks: LoggerSink[];
  private maxEntries: number;
  private defaultChannel: string;
  private clock: () => number;

  public onNewEntry?: (entry: LogEntry) => void;

  constructor(opts: DemoLoggerOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 50;
    this.defaultChannel = opts.defaultChannel ?? 'demo';
    this.sinks = opts.sinks ?? [new ConsoleSink()];
    this.clock = opts.clock ?? (() => performance.now());

    // Use real ring buffer for bounded O(1) appends (replaces previous push+shift which was O(n))
    this.entries = new RingBuffer<LogEntry>(this.maxEntries);

    // Seed basic counters
    (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).forEach(l => this.counters.set(l, 0));
  }

  log(
    message: string,
    opts: {
      level?: LogLevel;
      channel?: string;
      data?: unknown;
      tags?: Record<string, string | number | boolean>;
      error?: Error | { message: string; stack?: string };
      durationMs?: number;
    } = {}
  ) {
    const level: LogLevel = opts.level ?? 'info';
    const channel = opts.channel ?? this.defaultChannel;
    const now = new Date();
    const hr = this.clock();

    const entry: LogEntry = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      timestamp: now.toISOString(),
      hrTime: hr,
      level,
      channel,
      message,
      data: opts.data,
      tags: opts.tags,
      error: opts.error ? { message: (opts.error as any).message, stack: (opts.error as any).stack } : undefined,
      durationMs: opts.durationMs,
    };

    this.entries.push(entry); // O(1) thanks to real ring buffer (no shift)

    this.incrementCounter(level);
    if (channel) this.incrementCounter(`${level}:${channel}`);

    for (const sink of this.sinks) {
      try { sink.write(entry); } catch {}
    }
    this.onNewEntry?.(entry);
  }

  // Convenience methods (backward compat + new channel support)
  info(msg: string, opts: any = {}) { this.log(msg, { ...opts, level: 'info' }); }
  debug(msg: string, opts: any = {}) { this.log(msg, { ...opts, level: 'debug' }); }
  warn(msg: string, opts: any = {}) { this.log(msg, { ...opts, level: 'warn' }); }
  error(msg: string, opts: any = {}) { this.log(msg, { ...opts, level: 'error' }); }

  // Demo-specific convenience (maps to channel for now)
  jsondb(msg: string, opts: any = {}) { this.log(msg, { ...opts, level: 'info', channel: 'jsondb' }); }
  dev(msg: string, opts: any = {}) { this.log(msg, { ...opts, level: 'info', channel: 'dev' }); }

  // Timing helper — now stores durationMs in the entry
  startTimer(label: string, channel = 'perf') {
    const start = this.clock();
    return () => {
      const duration = +(this.clock() - start).toFixed(2);
      this.log(`[TIMING] ${label}`, {
        level: 'info',
        channel,
        durationMs: duration,
        tags: { label },
      });
      return duration;
    };
  }

  getMetrics() {
    return {
      total: this.entries.size,
      byLevel: Object.fromEntries(Array.from(this.counters.entries()).filter(([k]) => !k.includes(':'))),
      byChannel: Object.fromEntries(Array.from(this.counters.entries()).filter(([k]) => k.includes(':'))),
      recent: this.entries.toArray(), // snapshot only when metrics requested
    };
  }

  clear() {
    this.entries.clear();
    this.counters.clear();
    (['trace','debug','info','warn','error','fatal'] as const).forEach(l => this.counters.set(l, 0));
  }

  /** Simple child logger with inherited context (P1 feature from review). */
  child(extra: { channel?: string; tags?: Record<string, any> } = {}): DemoLogger {
    const child = new DemoLogger({
      maxEntries: this.maxEntries,
      defaultChannel: extra.channel ?? this.defaultChannel,
      sinks: this.sinks,
      clock: this.clock,
    });
    const parentOnEntry = this.onNewEntry;
    child.onNewEntry = (entry) => {
      const merged = { ...entry, tags: { ...(extra.tags || {}), ...(entry.tags || {}) } };
      parentOnEntry?.(merged);
      this.onNewEntry?.(merged); // bubble if wanted
    };
    return child;
  }

  private incrementCounter(key: string) {
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
}

// Console sink that preserves the exact prefix format the Playwright harness depends on
class ConsoleSink implements LoggerSink {
  write(entry: LogEntry) {
    const ch = entry.channel || entry.category;
    const prefix = `[DEMO:${entry.level}${ch ? `:${ch}` : ''}]`;
    console.log(`${prefix} ${entry.message}`);
  }
}

// Backwards-compatible helper — maps old demo 'kind' to new (level + channel)
export function createAddLog(logger: DemoLogger) {
  return (msg: string, kind: 'jsondb' | 'dev' | 'info' = 'info') => {
    if (kind === 'jsondb') logger.jsondb(msg);
    else if (kind === 'dev') logger.dev(msg);
    else logger.info(msg);
  };
}