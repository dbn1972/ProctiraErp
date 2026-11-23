/**
 * UAT-9d (#718 review follow-up 2): bound the `report.download.denied` audit volume.
 *
 * Per key (tenant, actor, artifact, reason) only the first denial in a window writes an audit
 * row. Repeats inside the window are counted in memory and reported as `suppressedCount` on
 * the next row written for that key. Keys live in a bounded LRU map, so a flood of distinct
 * keys cannot grow memory without limit; an evicted key simply records again. The counts are
 * per process (not shared between gateway replicas), which only means a replica may write one
 * extra row per window.
 */
export interface DenialAuditCoalescingOptions {
  /** Window per key in milliseconds (default 60 000). */
  windowMs?: number;
  /** Maximum keys kept (default 10 000). */
  maxKeys?: number;
  /** Clock (tests). */
  now?: () => number;
}

interface Entry {
  windowStart: number;
  suppressed: number;
}

export type DenialAdmission = { record: true; suppressedCount: number } | { record: false };

export class DenialAuditCoalescer {
  private readonly entries = new Map<string, Entry>();
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: DenialAuditCoalescingOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxKeys = Math.max(1, options.maxKeys ?? 10_000);
    this.now = options.now ?? Date.now;
  }

  /** Decide whether this denial writes an audit row, and with how many suppressed repeats. */
  admit(key: string): DenialAdmission {
    const now = this.now();
    const entry = this.entries.get(key);
    if (entry) this.entries.delete(key); // re-inserted below: most recently used last
    if (entry && now - entry.windowStart < this.windowMs) {
      entry.suppressed += 1;
      this.entries.set(key, entry);
      return { record: false };
    }
    this.entries.set(key, { windowStart: now, suppressed: 0 });
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { record: true, suppressedCount: entry?.suppressed ?? 0 };
  }
}
