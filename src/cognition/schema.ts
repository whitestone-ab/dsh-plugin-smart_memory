/**
 * Canonical memory data model shared by every layer of the plugin.
 *
 * The schema is deliberately plain TypeScript: persisted records are JSON, so a
 * record written by an older version must stay readable after an upgrade.
 */

export const MEMORY_KINDS = [
  'identity',
  'preference',
  'fact',
  'decision',
  'procedure',
  'episode',
] as const

export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_SCOPES = ['global', 'project'] as const

export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export const MEMORY_STATUSES = ['active', 'archived', 'forgotten'] as const

export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

export const EVIDENCE_SOURCES = ['user', 'assistant', 'tool', 'inference'] as const

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number]

/** Why the system believes a memory. Kept with the record, not in a side table. */
export interface MemoryEvidence {
  source: EvidenceSource
  /** Short verbatim quotation that supports the memory. */
  quote?: string
  sessionId?: string
  /** ISO-8601 timestamp of the observation. */
  at: string
}

/** A stored, versioned memory record. */
export interface MemoryEntry {
  id: string
  kind: MemoryKind
  scope: MemoryScope
  title: string
  content: string
  tags: string[]
  subject?: string
  predicate?: string
  value?: string
  evidence: MemoryEvidence[]
  /** 0..1 — how much the evidence supports the claim. */
  confidence: number
  /** 0..1 — how much the claim matters for future work. */
  importance: number
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
  accessCount: number
  version: number
  /** Id of the older memory this record replaces. */
  supersedes?: string
  /** Id of the newer memory that replaced this record. */
  supersededBy?: string
  /** ISO-8601 expiry; recall skips expired records. */
  expiresAt?: string
  /** Workspace/project this memory belongs to, when scoped to one. */
  projectPath?: string
}

/** Untrusted input accepted by the save pipeline. */
export interface MemoryCandidate {
  content: string
  title?: string
  kind?: MemoryKind
  scope?: MemoryScope
  tags?: string[]
  subject?: string
  predicate?: string
  value?: string
  importance?: number
  confidence?: number
  evidence?: MemoryEvidence[]
  expiresAt?: string
  projectPath?: string
}

/** Candidate after defaults and validation. */
export interface NormalizedCandidate {
  content: string
  title: string
  kind: MemoryKind
  scope: MemoryScope
  tags: string[]
  subject?: string
  predicate?: string
  value?: string
  importance: number
  confidence?: number
  expiresAt?: string
  projectPath?: string
}

/** A recall request. `text` may be empty to request the most important memories. */
export interface RecallQuery {
  text: string
  kinds?: readonly MemoryKind[]
  scope?: MemoryScope
  tags?: readonly string[]
  limit?: number
  minScore?: number
}

/** One ranked recall result. */
export interface RecallHit {
  entry: MemoryEntry
  score: number
  matchedTerms: string[]
}

/** Aggregate health information exposed by the status tool/command. */
export interface MemoryStats {
  total: number
  active: number
  archived: number
  forgotten: number
  byKind: Record<MemoryKind, number>
  averageConfidence: number
  lastUpdatedAt?: string
}

export const MAX_CONTENT_CHARS = 8_000
export const MIN_CONTENT_CHARS = 3
export const MAX_TITLE_CHARS = 120
export const MAX_TAGS = 12
export const MAX_TAG_CHARS = 40

/** Clamp a numeric value into the inclusive 0..1 range. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Type guard for persisted kind values. */
export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

/** Type guard for persisted scope values. */
export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && (MEMORY_SCOPES as readonly string[]).includes(value)
}

/** Type guard for persisted status values. */
export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === 'string' && (MEMORY_STATUSES as readonly string[]).includes(value)
}

/** Create a sortable, collision-resistant memory id. */
export function createMemoryId(now: Date = new Date()): string {
  const time = now.getTime().toString(36)
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `mem_${time}_${random}`
}

/**
 * Derive a stable, human-readable title when the caller did not supply one.
 * The first non-empty line is used so markdown-ish content stays readable.
 */
export function deriveTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.length > 0) ?? content.trim()
  const withoutMarkers = firstLine.replace(/^[#>*\-\s]+/u, '').trim()
  const base = withoutMarkers.length > 0 ? withoutMarkers : firstLine
  return base.length > MAX_TITLE_CHARS ? `${base.slice(0, MAX_TITLE_CHARS - 1)}…` : base
}

/** Lower-case, trim, de-duplicate and bound a tag list. */
export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/gu, '-')
    if (tag.length === 0 || tag.length > MAX_TAG_CHARS) continue
    seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

/** Normalize optional free-form fields, dropping empty strings. */
export function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Defaults applied before a candidate reaches the save policy. */
export function withDefaults(candidate: MemoryCandidate): NormalizedCandidate {
  const content = candidate.content.trim()
  const normalized: NormalizedCandidate = {
    content,
    title: optionalText(candidate.title) ?? deriveTitle(content),
    kind: candidate.kind ?? 'fact',
    scope: candidate.scope ?? 'project',
    tags: normalizeTags(candidate.tags),
    importance: clamp01(candidate.importance ?? 0.5),
  }
  if (candidate.confidence !== undefined) normalized.confidence = clamp01(candidate.confidence)
  const subject = optionalText(candidate.subject)
  const predicate = optionalText(candidate.predicate)
  const value = optionalText(candidate.value)
  const expiresAt = optionalText(candidate.expiresAt)
  const projectPath = optionalText(candidate.projectPath)
  if (subject !== undefined) normalized.subject = subject
  if (predicate !== undefined) normalized.predicate = predicate
  if (value !== undefined) normalized.value = value
  if (expiresAt !== undefined) normalized.expiresAt = expiresAt
  if (projectPath !== undefined) normalized.projectPath = projectPath
  return normalized
}

/** Validation result for untrusted candidate input. */
export type ValidationResult =
  | { ok: true; value: NormalizedCandidate }
  | { ok: false; reason: string }

/**
 * Validate a candidate and apply defaults. Expiry fields must parse as dates so
 * a typo can never silently create an immortal record.
 */
export function validateCandidate(input: MemoryCandidate): ValidationResult {
  if (typeof input.content !== 'string') {
    return { ok: false, reason: 'content must be a string' }
  }
  const trimmed = input.content.trim()
  if (trimmed.length < MIN_CONTENT_CHARS) {
    return { ok: false, reason: `content must be at least ${MIN_CONTENT_CHARS} characters` }
  }
  if (trimmed.length > MAX_CONTENT_CHARS) {
    return { ok: false, reason: `content must be at most ${MAX_CONTENT_CHARS} characters` }
  }
  if (input.kind !== undefined && !isMemoryKind(input.kind)) {
    return { ok: false, reason: `kind must be one of ${MEMORY_KINDS.join(', ')}` }
  }
  if (input.scope !== undefined && !isMemoryScope(input.scope)) {
    return { ok: false, reason: `scope must be one of ${MEMORY_SCOPES.join(', ')}` }
  }
  if (input.expiresAt !== undefined && Number.isNaN(Date.parse(input.expiresAt))) {
    return { ok: false, reason: 'expiresAt must be an ISO-8601 date' }
  }
  return { ok: true, value: withDefaults(input) }
}
