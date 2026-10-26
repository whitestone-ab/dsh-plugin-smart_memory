/**
 * CRUD and version bookkeeping over durable storage, with an in-memory index
 * kept in sync on every mutation.
 */

import type { MemoryEntry } from '../cognition/schema.js'
import type { Persistence } from '../storage/sqlite-store.js'
import { MemoryIndex } from './memory-index.js'

/** Options for opening a store. */
export interface MemoryStoreOptions {
  persistence: Persistence
}

/** In-memory view over one persistence backend. */
export class MemoryStore {
  private readonly entries = new Map<string, MemoryEntry>()
  private readonly index = new MemoryIndex()

  private constructor(private readonly persistence: Persistence) {}

  /**
   * Load every record and build the index.
   *
   * @param options - the already-opened persistence backend.
   */
  static async open(options: MemoryStoreOptions): Promise<MemoryStore> {
    const store = new MemoryStore(options.persistence)
    for (const entry of await options.persistence.load()) {
      store.entries.set(entry.id, entry)
      store.index.add(entry)
    }
    return store
  }

  /** @returns the active backend driver. */
  get driver(): 'sqlite' | 'json' {
    return this.persistence.driver
  }

  /** @returns the absolute path of the backing file. */
  get location(): string {
    return this.persistence.location
  }

  /** @returns every record, active or not, in insertion order. */
  all(): MemoryEntry[] {
    return [...this.entries.values()]
  }

  /** Read one record by id. */
  get(id: string): MemoryEntry | undefined {
    return this.entries.get(id)
  }

  /** Insert or replace one record and persist it. */
  async put(entry: MemoryEntry): Promise<void> {
    this.entries.set(entry.id, entry)
    this.index.update(entry)
    await this.persistence.save(entry)
  }

  /** Insert or replace several records, persisting each one. */
  async putMany(entries: readonly MemoryEntry[]): Promise<void> {
    for (const entry of entries) await this.put(entry)
  }

  /** Delete one record and persist the deletion. */
  async remove(id: string): Promise<void> {
    if (!this.entries.delete(id)) return
    this.index.remove(id)
    await this.persistence.remove(id)
  }

  /** Close the backend after pending writes settle. */
  async close(): Promise<void> {
    await this.persistence.close()
  }
}
