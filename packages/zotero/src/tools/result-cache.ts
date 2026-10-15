/**
 * Small in-memory cache for results that are expensive to recompute on every page (sorted search results, tag
 * counts). Pure: no Zotero globals (unit-tested in Node).
 *
 * Cursors are plain offsets, so without a cache every page re-runs the whole search and sort on Zotero's main
 * thread. A cache is DISABLED until enable() is called: the Zotero runtime enables it only while a Notifier
 * observer clears it on every library change (src/zotero/result-caches.ts), so a cached list cannot outlive the
 * data it was computed from. Entries also expire after `ttlMs`, and at most `maxEntries` are kept (the least
 * recently used one is evicted first).
 */
export class ResultCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();
  private active = false;
  /** Bumped by every clear(), so a computation that overlapped a change is never stored. */
  private generation = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.active;
  }

  get size(): number {
    return this.entries.size;
  }

  enable(): void {
    this.active = true;
  }

  /** Stop caching and drop everything (used when change notifications are no longer delivered). */
  disable(): void {
    this.active = false;
    this.clear();
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
  }

  get(key: string): V | undefined {
    if (!this.active) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    // Re-insert: Map iteration order doubles as the recency order.
    this.entries.set(key, entry);
    return entry.value;
  }

  private set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Cached value for `key`, else compute() (errors propagate and nothing is stored). */
  async getOrCompute(key: string, compute: () => V | Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const generation = this.generation;
    const value = await compute();
    if (this.active && generation === this.generation) this.set(key, value);
    return value;
  }
}
