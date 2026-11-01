import { ChunkCache } from "./ChunkCache";

/** Manifest cost is a conservative bound on owned decoded buffers and textures.
 * Shared resources must be owned by one entry or included in each owner cost.
 * A producer must not allocate over this bound, including during decoding.
 */
export interface ChunkDescriptor {
  id: string;
  residentBytes: number;
}

export interface ChunkManifest {
  worldBytes: number;
  chunks: readonly ChunkDescriptor[];
}

interface Slot<T> {
  id: string;
  loaded: boolean;
  value?: T;
}

/**
 * Schedules managed chunk allocations under a hard ten-percent reservation.
 * The producer owns cleanup of partial allocations if it throws or is aborted.
 * This class cannot account for resources created outside its producer.
 */
export class ChunkLoader<T> {
  private readonly chunks: Map<string, ChunkDescriptor>;
  private readonly cache: ChunkCache<Slot<T>>;
  private readonly active = new Set<string>();
  private desired = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private controller: AbortController | null = null;
  private closed = false;
  private generation = 0;

  public constructor(
    manifest: ChunkManifest,
    private readonly loadChunk: (chunk: ChunkDescriptor, signal: AbortSignal) => Promise<T>,
    private readonly disposeChunk: (value: T) => void,
  ) {
    if (!Number.isSafeInteger(manifest.worldBytes) || manifest.worldBytes <= 0) throw new RangeError("Invalid total world size");
    this.chunks = new Map();
    for (const chunk of manifest.chunks) {
      if (!chunk.id || this.chunks.has(chunk.id) || !Number.isSafeInteger(chunk.residentBytes) || chunk.residentBytes <= 0) throw new RangeError("Invalid chunk manifest");
      this.chunks.set(chunk.id, chunk);
    }
    const declared = [...this.chunks.values()].reduce((sum, item) => sum + item.residentBytes, 0);
    if (!Number.isSafeInteger(declared) || declared !== manifest.worldBytes) throw new RangeError("World size must equal the sum of chunk sizes");
    this.cache = new ChunkCache(Math.floor(manifest.worldBytes / 10));
  }

  public get usedBytes(): number { return this.cache.usedBytes; }
  public get limitBytes(): number { return this.cache.capacityBytes; }
  public get activeIds(): readonly string[] { return [...this.active]; }

  /** Earlier ids have priority when the entire visible set cannot fit. */
  public setDesired(ids: readonly string[]): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Chunk loader is closed"));
    for (const id of ids) if (!this.chunks.has(id)) return Promise.reject(new Error(`Unknown chunk: ${id}`));
    const desired = new Set(ids);
    this.desired = desired;
    const generation = ++this.generation;
    this.controller?.abort();
    const run = async () => {
      if (this.closed || generation !== this.generation) return;
      for (const id of [...this.active]) {
        if (!desired.has(id)) { this.active.delete(id); this.cache.unpin(id); }
      }
      for (const id of desired) {
        if (this.closed || generation !== this.generation) return;
        if (this.active.has(id)) { this.cache.get(id); continue; }
        const existing = this.cache.pin(id);
        if (existing) { this.active.add(id); continue; }
        const descriptor = this.chunks.get(id)!;
        const slot: Slot<T> = { id, loaded: false };
        if (!this.cache.put(id, slot, descriptor.residentBytes, (item) => {
          if (item.loaded) this.disposeChunk(item.value as T);
        })) continue;
        this.cache.pin(id);
        const controller = new AbortController(); this.controller = controller;
        try {
          const value = await this.loadChunk(descriptor, controller.signal);
          slot.value = value; slot.loaded = true;
          if (this.closed || generation !== this.generation || !this.desired.has(id)) {
            this.cache.unpin(id);
            if (this.closed) this.cache.remove(id);
          } else {
            this.active.add(id);
          }
        } catch (error) {
          this.cache.unpin(id); this.cache.remove(id);
          if (!controller.signal.aborted) throw error;
        } finally {
          if (this.controller === controller) this.controller = null;
        }
      }
    };
    this.queue = this.queue.catch(() => {}).then(run);
    return this.queue;
  }

  public async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.generation++; this.controller?.abort();
    await this.queue.catch(() => {});
    for (const id of this.active) this.cache.unpin(id);
    this.active.clear(); this.cache.clear();
  }
}
