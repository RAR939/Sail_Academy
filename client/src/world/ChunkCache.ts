/** Byte-accounted LRU for chunk resources. Active entries may be pinned. */
export interface CacheEntry<T> {
  value: T;
  bytes: number;
  dispose: (value: T) => void;
  pins: number;
}

export class ChunkCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private used = 0;
  public readonly capacityBytes: number;

  public constructor(capacityBytes: number) {
    if (!Number.isSafeInteger(capacityBytes) || capacityBytes < 0) throw new RangeError("Invalid cache capacity");
    this.capacityBytes = capacityBytes;
  }

  public get usedBytes(): number { return this.used; }
  public get count(): number { return this.entries.size; }
  public has(id: string): boolean { return this.entries.has(id); }

  /** Reading an entry makes it the most recently used. */
  public get(id: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.value;
  }

  /** Returns false without modifying the cache if the item cannot fit. */
  public put(id: string, value: T, bytes: number, dispose: (value: T) => void): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Invalid entry size");
    if (this.entries.has(id)) throw new Error(`Duplicate cache key: ${id}`);
    if (bytes > this.capacityBytes) return false;
    let reclaimable = this.capacityBytes - this.used;
    const victims: string[] = [];
    for (const [key, entry] of this.entries) {
      if (reclaimable >= bytes) break;
      if (entry.pins === 0) { victims.push(key); reclaimable += entry.bytes; }
    }
    if (reclaimable < bytes) return false;
    for (const key of victims) this.remove(key);
    this.entries.set(id, { value, bytes, dispose, pins: 0 });
    this.used += bytes;
    return true;
  }

  public pin(id: string): T | undefined {
    const value = this.get(id);
    const entry = this.entries.get(id);
    if (entry) entry.pins++;
    return value;
  }

  public unpin(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.pins === 0) throw new Error(`Chunk is not pinned: ${id}`);
    entry.pins--;
  }

  public remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.pins) throw new Error(`Cannot remove active chunk: ${id}`);
    this.entries.delete(id);
    this.used -= entry.bytes;
    entry.dispose(entry.value);
    return true;
  }

  public clear(): void {
    if ([...this.entries.values()].some((entry) => entry.pins)) throw new Error("Cannot clear active chunks");
    for (const id of this.entries.keys()) this.remove(id);
  }
}
