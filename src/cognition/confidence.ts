/**
 * Evidence and confidence evaluation.
 *
 * Confidence is deliberately conservative: a claim stated once by the user is
 * trusted, but a claim inferred by the model is not allowed to masquerade as a
 * user-stated fact.
 */

import type { EvidenceSource, MemoryEvidence } from './schema.js'
import { clamp01 } from './schema.js'

/** Per-source trust weight used when folding evidence. */
export const SOURCE_WEIGHT: Record<EvidenceSource, number> = {
  user: 0.95,
  tool: 0.85,
  assistant: 0.55,
  inference: 0.35,
}

/** Human-facing confidence band, used by status/export rendering. */
export type ConfidenceBand = 'low' | 'medium' | 'high'

/** @returns the band that a confidence value belongs to. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.75) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

/**
 * Fold evidence into one confidence value in 0..1.
 *
 * Each distinct source contributes diminishing trust, and extra corroborating
 * observations add a small bounded bonus. No evidence yields 0.3 — the memory
 * exists, but nothing yet vouches for it.
 */
export function assessConfidence(evidence: readonly MemoryEvidence[]): number {
  if (evidence.length === 0) return 0.3
  const sources = new Set(evidence.map(item => item.source))
  let confidence = 0.25
  for (const source of sources) {
    confidence += (1 - confidence) * SOURCE_WEIGHT[source] * 0.6
  }
  confidence += Math.min(0.15, Math.max(0, evidence.length - 1) * 0.03)
  return clamp01(confidence)
}

/**
 * Time-decay a confidence value. Facts do not become false with age, so the
 * decay is gentle (half-life 120 days by default) and floored at 0.05.
 */
export function decayConfidence(
  confidence: number,
  updatedAt: string,
  now: Date = new Date(),
  halfLifeDays = 120,
): number {
  const updated = Date.parse(updatedAt)
  if (Number.isNaN(updated)) return clamp01(confidence)
  const ageDays = Math.max(0, (now.getTime() - updated) / 86_400_000)
  const factor = Math.pow(0.5, ageDays / halfLifeDays)
  return clamp01(Math.max(0.05, confidence * factor))
}

/**
 * Combine an existing confidence with a fresh observation. The newer evidence
 * can raise or lower the value, but never by more than 40% of the gap, so one
 * stray contradiction does not erase long-standing corroboration.
 */
export function combineConfidence(current: number, observed: number): number {
  const delta = clamp01(observed) - clamp01(current)
  return clamp01(current + delta * 0.4)
}
