/**
 * Retrieval and ranking policy: tokenization, lexical scoring, recency, and
 * filtering. Pure functions only — persistence and access bookkeeping live in
 * the service layer.
 */

import type { MemoryEntry, MemoryKind, RecallHit, RecallQuery } from './schema.js'

/** Common English and Chinese tokens that carry no retrieval signal. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'was',
  'were', 'are', 'you', 'your', 'our', 'not', 'but', 'can', 'could', 'should',
  'would', 'will', 'about', 'into', 'than', 'then', 'they', 'them', 'its',
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '可以', '需要', '就是',
  '还是', '因为', '所以', '但是', '如果', '已经', '一个', '没有', '不是',
])

/** One CJK character. Used to split mixed Latin/CJK text into runs. */
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/u

/** Latin/digit token, allowing common identifier punctuation inside a token. */
const LATIN_TOKEN = /[a-z0-9][a-z0-9_+.#-]*/gu

/**
 * Tokenize text for the inverted index and lexical scoring.
 *
 * Latin words are lower-cased whole tokens; CJK runs are indexed as unigrams
 * (single-character queries) plus bigrams (the useful retrieval unit). This
 * keeps Chinese recall working without a segmenter dependency.
 */
export function tokenize(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.toLowerCase().normalize('NFKC')
  const tokens = new Set<string>()
  for (const match of normalized.matchAll(LATIN_TOKEN)) {
    // Trailing sentence punctuation belongs to the sentence, not the token.
    const token = match[0].replace(/[._+.#-]+$/u, '')
    if (token.length >= 2 && !STOPWORDS.has(token)) tokens.add(token)
  }
  let run = ''
  const flush = (): void => {
    if (run.length === 0) return
    if (run.length === 1) {
      if (!STOPWORDS.has(run)) tokens.add(run)
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2)
      if (!STOPWORDS.has(bigram)) tokens.add(bigram)
    }
    run = ''
  }
  for (const char of normalized) {
    if (CJK_CHAR.test(char)) run += char
    else flush()
  }
  flush()
  return [...tokens]
}

/** Jaccard similarity of two token sets, in 0..1. */
export function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const a = new Set(left)
  const b = new Set(right)
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** True when a memory has a deadline that has already passed. */
export function isExpired(entry: MemoryEntry, now: Date = new Date()): boolean {
  if (entry.expiresAt === undefined) return false
  const expiry = Date.parse(entry.expiresAt)
  return !Number.isNaN(expiry) && expiry <= now.getTime()
}

/** Exponential recency score with a configurable half-life. */
export function recencyScore(updatedAt: string, now: Date, halfLifeDays = 30): number {
  const updated = Date.parse(updatedAt)
  if (Number.isNaN(updated)) return 0.5
  const ageDays = Math.max(0, (now.getTime() - updated) / 86_400_000)
  return Math.pow(0.5, ageDays / halfLifeDays)
}

/** Weights for the lexical score blend. They sum to 1. */
export interface RecallWeights {
  lexical: number
  importance: number
  confidence: number
  recency: number
}

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  lexical: 0.6,
  importance: 0.18,
  confidence: 0.14,
  recency: 0.08,
}

/** Options accepted by {@link rankEntries}. */
export interface RankOptions {
  now?: Date
  weights?: RecallWeights
}

/** The searchable text of one entry. */
export function entryText(entry: MemoryEntry): string {
  return [
    entry.title,
    entry.content,
    entry.subject ?? '',
    entry.predicate ?? '',
    entry.value ?? '',
    entry.tags.join(' '),
  ].join(' ')
}

/**
 * Score and filter entries for one query.
 *
 * Results are ordered by score, then importance, then freshness so ties never
 * depend on Map insertion order.
 */
export function rankEntries(
  entries: readonly MemoryEntry[],
  query: RecallQuery,
  options: RankOptions = {},
): RecallHit[] {
  const now = options.now ?? new Date()
  const weights = options.weights ?? DEFAULT_RECALL_WEIGHTS
  const queryTokens = tokenize(query.text)
  const wanted = new Set(queryTokens)
  const kinds = query.kinds === undefined || query.kinds.length === 0
    ? undefined
    : new Set<MemoryKind>(query.kinds)
  const tags = query.tags === undefined || query.tags.length === 0
    ? undefined
    : query.tags.map(tag => tag.trim().toLowerCase())
  const minScore = query.minScore ?? 0.02
  const hits: RecallHit[] = []

  for (const entry of entries) {
    if (entry.status !== 'active') continue
    if (query.scope !== undefined && entry.scope !== query.scope) continue
    if (kinds !== undefined && !kinds.has(entry.kind)) continue
    if (tags !== undefined && !tags.every(tag => entry.tags.includes(tag))) continue
    if (isExpired(entry, now)) continue

    const matchedTerms = wanted.size === 0
      ? []
      : tokenize(entryText(entry)).filter(token => wanted.has(token))
    const lexical = wanted.size === 0 ? 0 : matchedTerms.length / wanted.size
    if (wanted.size > 0 && lexical === 0) continue

    const score = Math.min(1,
      weights.lexical * lexical
      + weights.importance * entry.importance
      + weights.confidence * entry.confidence
      + weights.recency * recencyScore(entry.updatedAt, now)
      + Math.min(0.08, entry.accessCount * 0.01),
    )
    if (score < minScore) continue
    hits.push({ entry, score, matchedTerms })
  }

  hits.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (right.entry.importance !== left.entry.importance) {
      return right.entry.importance - left.entry.importance
    }
    return Date.parse(right.entry.updatedAt) - Date.parse(left.entry.updatedAt)
  })

  const limit = query.limit ?? hits.length
  return limit >= hits.length ? hits : hits.slice(0, Math.max(0, limit))
}
