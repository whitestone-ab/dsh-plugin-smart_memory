/**
 * `memory_recall` — search persistent memory and return ranked snippets.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryKind, RecallHit } from '../cognition/schema.js'
import { isMemoryKind } from '../cognition/schema.js'
import type { ServiceProvider } from '../services/memory-service.js'

/** Parse a comma/space separated kind list, ignoring unknown values. */
function parseKinds(value: string | undefined): MemoryKind[] | undefined {
  if (value === undefined) return undefined
  const kinds = value
    .split(/[\s,;]+/u)
    .map(part => part.trim().toLowerCase())
    .filter((part): part is MemoryKind => isMemoryKind(part))
  return kinds.length === 0 ? undefined : kinds
}

/** Render hits as compact Markdown for the model and the UI card. */
export function formatHits(hits: readonly RecallHit[], query: string): string {
  if (hits.length === 0) {
    return query.trim().length === 0
      ? 'No memories stored yet.'
      : `No memories matched "${query.trim()}".`
  }
  const lines = [`Recalled ${hits.length} memory record(s):`, '']
  hits.forEach((hit, index) => {
    const entry = hit.entry
    const tags = entry.tags.length > 0 ? ` · tags: ${entry.tags.join(', ')}` : ''
    lines.push(
      `${index + 1}. [${entry.kind}] **${entry.title}** (score ${hit.score.toFixed(2)}, confidence ${entry.confidence.toFixed(2)})`,
      `   ${entry.content.replace(/\s+/gu, ' ')}`,
      `   id: \`${entry.id}\`${tags}`,
    )
  })
  return lines.join('\n')
}

/** Register the recall tool on the calling context. */
export function registerMemoryRecall(ctx: Context, getService: ServiceProvider): void {
  ctx.tools.register(defineTool({
    name: 'memory_recall',
    description: [
      'Search the user\'s persistent memory for facts, preferences, decisions, and procedures',
      'captured in earlier sessions. Use it before asking the user to repeat themselves.',
      'An empty query returns the most important memories.',
    ].join(' '),
    parameters: {
      query: {
        type: 'string',
        description: 'What to look for. Empty string lists the most important memories.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of records to return (1-20).',
      },
      kinds: {
        type: 'string',
        description: 'Optional comma-separated kinds: identity, preference, fact, decision, procedure, episode.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const service = await getService()
      const query = typeof args.query === 'string' ? args.query : ''
      const rawLimit = typeof args.limit === 'number' ? args.limit : 8
      const limit = Math.min(20, Math.max(1, Math.trunc(rawLimit)))
      const kinds = parseKinds(typeof args.kinds === 'string' ? args.kinds : undefined)
      const hits = await service.recall({
        text: query,
        limit,
        ...kinds === undefined ? {} : { kinds },
      })
      return formatHits(hits, query)
    },
  }))
}
