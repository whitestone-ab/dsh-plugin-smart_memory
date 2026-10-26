/**
 * Unified memory service: the single entry point used by tools, commands,
 * context injection, and lifecycle hooks.
 */

import { extname, join } from 'node:path'
import type {
  EvidenceSource,
  MemoryCandidate,
  MemoryEntry,
  MemoryEvidence,
  MemoryKind,
  MemoryStats,
  NormalizedCandidate,
  RecallHit,
  RecallQuery,
} from '../cognition/schema.js'
import {
  EVIDENCE_SOURCES,
  MEMORY_KINDS,
  clamp01,
  createMemoryId,
  validateCandidate,
} from '../cognition/schema.js'
import { assessConfidence } from '../cognition/confidence.js'
import { rankEntries } from '../cognition/recall-policy.js'
import { mergeEntries, planSave } from '../cognition/save-policy.js'
import { DEFAULT_SAVE_POLICY } from '../cognition/save-policy.js'
import { planConsolidation } from '../cognition/consolidate.js'
import { openPersistence } from '../storage/sqlite-store.js'
import { MemoryStore } from './memory-store.js'

/** Minimal logger surface accepted by the service. */
export interface LoggerLike {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Construction options. */
export interface MemoryServiceOptions {
  /** Directory (or `.sqlite`/`.json` stem) holding the memory database. */
  storagePath: string
  recallLimit?: number
  minConfidence?: number
  logger?: LoggerLike
}

/** One save request, with optional explicit confidence. */
export interface SaveRequest {
  candidate: MemoryCandidate
  evidence?: MemoryEvidence[]
  confidence?: number
}

/** Result of one save. */
export interface SaveOutcome {
  action: 'insert' | 'merge' | 'supersede' | 'reject'
  reason: string
  entry?: MemoryEntry
  mergedInto?: string
  conflicts: number
}

/** Result of one consolidation pass. */
export interface ConsolidationReport {
  mergedGroups: number
  archived: number
  promoted: number
}

/** Forget semantics: keep an archived tombstone, or delete the record. */
export type ForgetMode = 'archive' | 'delete'

/** Report returned by {@link MemoryService.status}. */
export interface MemoryStatusReport extends MemoryStats {
  driver: 'sqlite' | 'json'
  location: string
  totalChars: number
}

/** Every registration path resolves the same lazily-initialised service. */
export type ServiceProvider = () => Promise<MemoryService>

const DEFAULT_RECALL_LIMIT = 8
const DEFAULT_MIN_CONFIDENCE = 0.35

/** @returns whether a persisted evidence source is valid. */
function isEvidenceSource(value: unknown): value is EvidenceSource {
  return typeof value === 'string' && (EVIDENCE_SOURCES as readonly string[]).includes(value)
}

/** Normalize evidence and guarantee at least one observation. */
function collectEvidence(
  candidate: MemoryCandidate,
  extra: readonly MemoryEvidence[] | undefined,
  now: Date,
): MemoryEvidence[] {
  const collected: MemoryEvidence[] = []
  const seen = new Set<string>()
  for (const item of [...(candidate.evidence ?? []), ...(extra ?? [])]) {
    if (typeof item !== 'object' || item === null) continue
    if (!isEvidenceSource(item.source)) continue
    const at = typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at))
      ? item.at
      : now.toISOString()
    const key = `${item.source}|${at}|${item.quote ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const evidence: MemoryEvidence = { source: item.source, at }
    if (item.quote !== undefined) evidence.quote = item.quote.slice(0, 500)
    if (item.sessionId !== undefined) evidence.sessionId = item.sessionId
    collected.push(evidence)
  }
  if (collected.length === 0) {
    collected.push({ source: 'assistant', at: now.toISOString() })
  }
  return collected
}

/** Derive the on-disk stem from a configured directory or file path. */
function resolveBasePath(storagePath: string): string {
  const extension = extname(storagePath).toLowerCase()
  if (extension === '.sqlite' || extension === '.json') {
    return storagePath.slice(0, -extension.length)
  }
  return join(storagePath, 'memory')
}

export class MemoryService {
  private task = ''

  private constructor(
    private readonly store: MemoryStore,
    private readonly recallLimit: number,
    private readonly minConfidence: number,
    private readonly logger?: LoggerLike,
  ) {}

  /**
   * Open the store and return a ready service.
   *
   * @param options - storage location and policy overrides.
   */
  static async create(options: MemoryServiceOptions): Promise<MemoryService> {
    const persistence = await openPersistence(resolveBasePath(options.storagePath))
    const store = await MemoryStore.open({ persistence })
    const service = new MemoryService(
      store,
      options.recallLimit ?? DEFAULT_RECALL_LIMIT,
      options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      options.logger,
    )
    options.logger?.info(`memory store ready (${persistence.driver}: ${persistence.location})`)
    return service
  }

  /** @returns the backing driver. */
  get driver(): 'sqlite' | 'json' {
    return this.store.driver
  }

  /** @returns the backing file location. */
  get location(): string {
    return this.store.location
  }

  /** The most recent user request, used for task-aware recall. */
  get lastTask(): string {
    return this.task
  }

  set lastTask(value: string) {
    this.task = value.trim().slice(0, 4_000)
  }

  /**
   * Save a candidate through the write policy.
   *
   * The policy may insert, merge into a near-duplicate, supersede a
   * contradicted memory, or reject the candidate.
   */
  async save(request: SaveRequest): Promise<SaveOutcome> {
    const validation = validateCandidate(request.candidate)
    if (!validation.ok) {
      return { action: 'reject', reason: validation.reason, conflicts: 0 }
    }
    const candidate = validation.value
    const now = new Date()
    const evidence = collectEvidence(request.candidate, request.evidence, now)
    const confidence = clamp01(
      request.confidence
      ?? candidate.confidence
      ?? assessConfidence(evidence),
    )
    const plan = planSave(candidate, confidence, this.store.all(), {
      minConfidence: this.minConfidence,
      dedupeThreshold: DEFAULT_SAVE_POLICY.dedupeThreshold,
    })

    if (plan.action === 'reject') {
      return { action: 'reject', reason: plan.reason, conflicts: 0 }
    }

    if (plan.action === 'merge' && plan.targetId !== undefined) {
      const existing = this.store.get(plan.targetId)
      if (existing !== undefined) {
        const merged = mergeEntries(existing, candidate, confidence, evidence, now)
        await this.store.put(merged)
        return {
          action: 'merge',
          reason: plan.reason,
          entry: merged,
          mergedInto: existing.id,
          conflicts: 0,
        }
      }
    }

    if (plan.action === 'supersede' && plan.targetId !== undefined) {
      const existing = this.store.get(plan.targetId)
      const replacement = this.buildEntry(
        candidate,
        evidence,
        confidence,
        now,
        existing?.id,
      )
      if (existing !== undefined) {
        const archived: MemoryEntry = {
          ...existing,
          status: 'archived',
          supersededBy: replacement.id,
          updatedAt: now.toISOString(),
          version: existing.version + 1,
        }
        await this.store.put(archived)
      }
      await this.store.put(replacement)
      return {
        action: 'supersede',
        reason: plan.reason,
        entry: replacement,
        conflicts: plan.conflicts.length,
      }
    }

    const entry = this.buildEntry(candidate, evidence, confidence, now)
    await this.store.put(entry)
    return { action: 'insert', reason: plan.reason, entry, conflicts: 0 }
  }

  /**
   * Rank memories without touching access counters. Safe to call from a
   * synchronous system-prompt provider.
   */
  recallSync(query: RecallQuery): RecallHit[] {
    return rankEntries(this.store.all(), {
      ...query,
      limit: query.limit ?? this.recallLimit,
    })
  }

  /** Rank memories and record the access (used by tools and commands). */
  async recall(query: RecallQuery): Promise<RecallHit[]> {
    const hits = this.recallSync(query)
    if (hits.length === 0) return hits
    const now = new Date().toISOString()
    for (const hit of hits) {
      const entry = hit.entry
      const updated: MemoryEntry = {
        ...entry,
        accessCount: entry.accessCount + 1,
        lastAccessedAt: now,
      }
      // Mutate the hit too, so callers observe the access they just caused.
      hit.entry = updated
      await this.store.put(updated)
    }
    return hits
  }

  /** The most important active memories, ignoring a query. */
  highlights(limit = this.recallLimit): RecallHit[] {
    return this.recallSync({ text: '', limit })
  }

  /** Archive or delete one memory. */
  async forget(id: string, mode: ForgetMode = 'archive'): Promise<MemoryEntry | undefined> {
    const entry = this.store.get(id)
    if (entry === undefined) return undefined
    const now = new Date().toISOString()
    if (mode === 'delete') {
      await this.store.remove(id)
      const tombstone: MemoryEntry = {
        ...entry,
        status: 'forgotten',
        updatedAt: now,
        version: entry.version + 1,
      }
      return tombstone
    }
    const archived: MemoryEntry = {
      ...entry,
      status: 'archived',
      updatedAt: now,
      version: entry.version + 1,
    }
    await this.store.put(archived)
    return archived
  }

  /** Aggregate health and storage information. */
  status(): MemoryStatusReport {
    const entries = this.store.all()
    const byKind = Object.fromEntries(MEMORY_KINDS.map(kind => [kind, 0])) as Record<MemoryKind, number>
    let active = 0
    let archived = 0
    let forgotten = 0
    let confidenceSum = 0
    let totalChars = 0
    let lastUpdatedAt: string | undefined
    for (const entry of entries) {
      byKind[entry.kind] += 1
      totalChars += entry.content.length
      if (entry.status === 'active') {
        active += 1
        confidenceSum += entry.confidence
      } else if (entry.status === 'archived') {
        archived += 1
      } else {
        forgotten += 1
      }
      if (lastUpdatedAt === undefined || Date.parse(entry.updatedAt) > Date.parse(lastUpdatedAt)) {
        lastUpdatedAt = entry.updatedAt
      }
    }
    const stats: MemoryStats = {
      total: entries.length,
      active,
      archived,
      forgotten,
      byKind,
      averageConfidence: active === 0 ? 0 : confidenceSum / active,
      lastUpdatedAt,
    }
    return {
      ...stats,
      driver: this.store.driver,
      location: this.store.location,
      totalChars,
    }
  }

  /** Serialize every record. `format` selects JSON or a readable Markdown digest. */
  exportRecords(format: 'json' | 'markdown' = 'json'): string {
    const entries = this.store.all()
    if (format === 'json') {
      return `${JSON.stringify({
        schema: 'smart-memory/v1',
        exportedAt: new Date().toISOString(),
        entries,
      }, null, 2)}\n`
    }
    const lines: string[] = [
      '# Smart memory export',
      '',
      `Exported: ${new Date().toISOString()}`,
      `Records: ${entries.length}`,
      '',
    ]
    for (const kind of MEMORY_KINDS) {
      const group = entries.filter(entry => entry.kind === kind)
      if (group.length === 0) continue
      lines.push(`## ${kind}`, '')
      for (const entry of group) {
        lines.push(`- **${entry.title}** — ${entry.content.replace(/\s+/gu, ' ')}`)
        lines.push(`  - id: \`${entry.id}\` · confidence: ${entry.confidence.toFixed(2)} · status: ${entry.status}`)
      }
      lines.push('')
    }
    return `${lines.join('\n')}\n`
  }

  /** Run one consolidation pass and persist every resulting change. */
  async consolidate(now: Date = new Date()): Promise<ConsolidationReport> {
    const plan = planConsolidation(this.store.all(), now)
    const stamp = now.toISOString()
    let archived = 0

    for (const group of plan.merges) {
      await this.store.put({ ...group.merged, updatedAt: stamp })
      for (const dropId of group.dropIds) {
        const drop = this.store.get(dropId)
        if (drop === undefined) continue
        await this.store.put({
          ...drop,
          status: 'archived',
          supersededBy: group.keep.id,
          updatedAt: stamp,
          version: drop.version + 1,
        })
        archived += 1
      }
    }

    for (const id of plan.archiveIds) {
      const entry = this.store.get(id)
      if (entry === undefined) continue
      await this.store.put({
        ...entry,
        status: 'archived',
        updatedAt: stamp,
        version: entry.version + 1,
      })
      archived += 1
    }

    let promoted = 0
    for (const id of plan.promoteIds) {
      const entry = this.store.get(id)

      // Revalidate the current state before applying the plan.
      if (
        entry === undefined
        || entry.status !== 'active'
        || entry.kind !== 'episode'
      ) continue

      await this.store.put({
        ...entry,
        kind: 'fact',
        importance: Math.max(entry.importance, 0.6),
        updatedAt: stamp,
        version: entry.version + 1,
      })
      promoted += 1
    }

    if (plan.merges.length > 0 || archived > 0 || promoted > 0) {
      this.logger?.info(
        `consolidation: ${plan.merges.length} merged group(s), ${archived} archived, ${promoted} promoted`,
      )
    }
    return { mergedGroups: plan.merges.length, archived, promoted }
  }

  /** Flush and close the backing store. */
  async close(): Promise<void> {
    await this.store.close()
  }

  /** Build a fresh record from a validated candidate. */
  private buildEntry(
    candidate: NormalizedCandidate,
    evidence: MemoryEvidence[],
    confidence: number,
    now: Date,
    supersedes?: string,
  ): MemoryEntry {
    const stamp = now.toISOString()
    const entry: MemoryEntry = {
      id: createMemoryId(now),
      kind: candidate.kind,
      scope: candidate.scope,
      title: candidate.title,
      content: candidate.content,
      tags: candidate.tags,
      evidence,
      confidence,
      importance: candidate.importance,
      status: 'active',
      createdAt: stamp,
      updatedAt: stamp,
      lastAccessedAt: stamp,
      accessCount: 0,
      version: 1,
    }
    if (candidate.subject !== undefined) entry.subject = candidate.subject
    if (candidate.predicate !== undefined) entry.predicate = candidate.predicate
    if (candidate.value !== undefined) entry.value = candidate.value
    if (candidate.expiresAt !== undefined) entry.expiresAt = candidate.expiresAt
    if (candidate.projectPath !== undefined) entry.projectPath = candidate.projectPath
    if (supersedes !== undefined) entry.supersedes = supersedes
    return entry
  }
}
