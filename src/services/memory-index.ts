/**
 * Inverted index over active memory text. It narrows recall candidates before
 * the (more expensive) scoring pass; it is rebuilt from records on startup, so
 * it is never a source of truth.
 */

import type { MemoryEntry } from '../cognition/schema.js'
import { tokenize } from '../cognition/recall-policy.js'

export class MemoryIndex {
  private readonly postings = new Map<string, Set<string>>()
  private readonly documents = new Map<string, ReadonlySet<string>>()

  /** @returns the number of indexed documents. */
  get size(): number {
    return this.documents.size
  }

  /** Replace the whole index. */
  rebuild(entries: readonly MemoryEntry[]): void {
    this.postings.clear()
    this.documents.clear()
    for (const entry of entries) this.add(entry)
  }

  /** Index one entry, replacing any previous version. */
  update(entry: MemoryEntry): void {
    this.remove(entry.id)
    this.add(entry)
  }

  /** Remove one entry. */
  remove(id: string): void {
    const tokens = this.documents.get(id)
    if (tokens === undefined) return
    for (const token of tokens) {
      const ids = this.postings.get(token)
      if (ids === undefined) continue
      ids.delete(id)
      if (ids.size === 0) this.postings.delete(token)
    }
    this.documents.delete(id)
  }

  /**
   * Match query tokens against indexed documents.
   *
   * @returns a map of entry id to the terms it matched, ordered by no
   * particular rule — the ranking policy owns ordering.
   */
  match(queryTokens: readonly string[]): Map<string, string[]> {
    const matched = new Map<string, string[]>()
    for (const token of queryTokens) {
      const ids = this.postings.get(token)
      if (ids === undefined) continue
      for (const id of ids) {
        const terms = matched.get(id)
        if (terms === undefined) matched.set(id, [token])
        else if (!terms.includes(token)) terms.push(token)
      }
    }
    return matched
  }

  /** Index one entry without removing a previous version. */
  add(entry: MemoryEntry): void {
    const tokens = new Set(tokenize([
      entry.title,
      entry.content,
      entry.subject ?? '',
      entry.predicate ?? '',
      entry.value ?? '',
      entry.tags.join(' '),
    ].join(' ')))
    this.documents.set(entry.id, tokens)
    for (const token of tokens) {
      const ids = this.postings.get(token)
      if (ids === undefined) this.postings.set(token, new Set([entry.id]))
      else ids.add(entry.id)
    }
  }
}
