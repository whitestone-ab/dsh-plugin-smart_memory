/**
 * Captures durable memory candidates from session traffic.
 *
 * Two jobs are deliberately separate:
 * - tracking the latest user request (used for task-aware recall), which is
 *   always on;
 * - persisting explicitly stated memories, which is opt-in because it writes
 *   to long-term storage.
 *
 * The session-event payload is intentionally treated as untrusted `unknown`:
 * the plugin must keep working when the event shape evolves.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryCandidate, MemoryEvidence, MemoryKind } from '../cognition/schema.js'
import type { LoggerLike } from '../services/memory-service.js'

/** A memory extracted by a conservative phrase pattern. */
export interface CapturedMemory {
  content: string
  kind: MemoryKind
  tags: string[]
  /** Raw matched text from the source message, for evidence. */
  quote: string
}

interface CapturePattern {
  regex: RegExp
  kind: MemoryKind
  tags: string[]
}

const PATTERNS: readonly CapturePattern[] = [
  {
    regex: /(?:请?记住|记一下|帮我记住|remember(?: that)?)[:：,，\s]+([^。！？.!?\n]{4,200})/iu,
    kind: 'fact',
    tags: ['explicit', 'auto-capture'],
  },
  {
    regex: /(?:我(?:更)?(?:喜欢|偏好|习惯|倾向于)|i (?:prefer|like|usually|always use))[:：,，\s]*([^。！？.!?\n]{4,200})/iu,
    kind: 'preference',
    tags: ['preference', 'auto-capture'],
  },
  {
    regex: /(?:我们?(?:决定|约定|确定|统一)|we (?:decided|agreed|settled on))[:：,，\s]*([^。！？.!?\n]{4,200})/iu,
    kind: 'decision',
    tags: ['decision', 'auto-capture'],
  },
]

/** Keys whose values can carry human text in a session event. */
const TEXT_KEYS = new Set(['text', 'content', 'message', 'prompt', 'data', 'input', 'payload'])

/** Extract explicit memory statements from one block of text. */
export function extractMemories(text: string): CapturedMemory[] {
  const found: CapturedMemory[] = []
  const seen = new Set<string>()
  for (const pattern of PATTERNS) {
    // `matchAll` requires the `g` flag; clone instead of mutating the shared pattern.
    const regex = new RegExp(
      pattern.regex.source,
      pattern.regex.flags.includes('g')
        ? pattern.regex.flags
        : `${pattern.regex.flags}g`,
    )
    for (const match of text.matchAll(regex)) {
      const raw = match[1]
      if (raw === undefined) continue
      const content = raw.trim().replace(/\s+/gu, ' ')
      if (content.length < 4) continue
      const key = content.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      found.push({
        content,
        kind: pattern.kind,
        tags: pattern.tags,
        quote: match[0],
      })
    }
  }
  return found
}

/** Recursively collect likely human text from an unknown payload. */
function extractText(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(item => extractText(item, depth + 1)).filter(Boolean).join('\n')
  }
  if (typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const parts: string[] = []
  for (const [key, nested] of Object.entries(record)) {
    if (!TEXT_KEYS.has(key)) continue
    const text = extractText(nested, depth + 1)
    if (text.length > 0) parts.push(text)
  }
  return parts.join('\n')
}

/**
 * Source kinds DSH uses for trusted user messages.
 *
 * This is a provenance marker, not human-identity verification: some
 * programmatic entry points also send `kind: 'user'`.
 */
const TRUSTED_USER_SOURCES = new Set(['user'])

/**
 * Decide whether an event is a trusted user message, using the native DSH
 * `user/message` shape instead of guessing from loose `role`/`type` strings.
 *
 * Every condition is required, so missing or unknown provenance is rejected
 * rather than treated as user input.
 */
function isTrustedUserEvent(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const event = value as Record<string, unknown>

  if (event.type !== 'user/message') return false

  const data = event.data
  if (data === null || typeof data !== 'object') return false
  const record = data as Record<string, unknown>

  if (record.role !== 'user') return false

  const source = record.source
  if (source === null || typeof source !== 'object') return false
  const kind = (source as Record<string, unknown>).kind

  return typeof kind === 'string' && TRUSTED_USER_SOURCES.has(kind)
}

/** Options for {@link SessionCapture}. */
export interface SessionCaptureOptions {
  /** Persist extracted memories to the store. */
  persist: boolean
  /** Upper bound on captured request text. */
  maxChars: number
  /** Always called with the latest user request text. */
  onUserText?: (text: string) => void
  /** Persistence callback invoked for each extracted memory. */
  onMemory?: (candidate: MemoryCandidate, evidence: MemoryEvidence[]) => Promise<unknown>
  logger?: LoggerLike
}

export class SessionCapture {
  private lastText = ''

  constructor(private readonly options: SessionCaptureOptions) {}

  /** Observe one raw session event. */
  observe(payload: unknown): void {
    if (!isTrustedUserEvent(payload)) return
    const text = extractText(payload).trim()
    if (text.length === 0) return
    const bounded = text.slice(-this.options.maxChars)
    if (bounded === this.lastText) return
    this.lastText = bounded
    this.options.onUserText?.(bounded)

    if (!this.options.persist || this.options.onMemory === undefined) return
    for (const memory of extractMemories(bounded)) {
      // Each memory keeps its own source quote; `quote` never enters the candidate.
      // The statement sits at the end of the match, so an over-long match is trimmed
      // from the front: a bounded prefix would cut the text the memory is based on.
      const evidence: MemoryEvidence[] = [{
        source: 'user',
        at: new Date().toISOString(),
        quote: memory.quote.length > 300
          ? memory.quote.slice(-300)
          : memory.quote,
      }]
      void this.options.onMemory({
        content: memory.content,
        kind: memory.kind,
        tags: memory.tags,
        importance: 0.5,
      }, evidence).catch((error: unknown) => {
        this.options.logger?.warn(`smart-memory auto-capture failed: ${String(error)}`)
      })
    }
  }
}

/**
 * Metadata-only description of a session event, used by the opt-in runtime
 * diagnostic. Message text is never included.
 */
function describeEvent(event: unknown): string {
  const asRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object'
      ? value as Record<string, unknown>
      : {}

  const record = asRecord(event)
  const data = asRecord(record['data'])
  const source = asRecord(data['source'])
  const content = Array.isArray(data['content']) ? data['content'] : []
  const blocks = content.map((block) => {
    const type = asRecord(block)['type']
    return typeof type === 'string' ? type : 'unknown'
  })

  return '[smart-memory] event=' + String(record['type'])
    + ' role=' + String(data['role'] ?? 'missing')
    + ' source=' + String(source['kind'] ?? 'missing')
    + ' blocks=' + (blocks.length > 0 ? blocks.join(',') : 'none')
}

/**
 * Attach the capture to the `session/event` stream.
 *
 * The host emits `(session, event)`, so the event is the second argument. The
 * earlier `second ?? first` fallback silently fed non-user payloads into the
 * capture and is deliberately gone: without the event argument there is
 * nothing to observe.
 *
 * Set `DSH_SMART_MEMORY_DEBUG=1` to log event metadata while verifying the
 * real host payload; the message body is never logged.
 *
 * Registration is best-effort: if the host does not expose the event, the
 * plugin keeps its tools and prompt injection instead of failing to load.
 */
export function installSessionCapture(
  ctx: Context,
  capture: SessionCapture,
  logger?: LoggerLike,
): void {
  const bus = ctx as unknown as {
    on?: (name: string, listener: (...args: unknown[]) => void) => unknown
  }
  if (typeof bus.on !== 'function') {
    logger?.warn('smart-memory: session events are unavailable; auto-capture is inactive')
    return
  }
  try {
    bus.on('session/event', (_session: unknown, event: unknown) => {
      if (process.env.DSH_SMART_MEMORY_DEBUG === '1') {
        logger?.info(describeEvent(event))
      }
      capture.observe(event)
    })
  } catch (error: unknown) {
    logger?.warn(`smart-memory: cannot observe session events: ${String(error)}`)
  }
}
