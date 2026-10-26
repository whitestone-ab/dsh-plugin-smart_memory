/**
 * `memory_save` — persist a durable fact, preference, decision, or procedure.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryCandidate, MemoryKind, MemoryScope } from '../cognition/schema.js'
import { isMemoryKind, isMemoryScope } from '../cognition/schema.js'
import type { SaveOutcome, ServiceProvider } from '../services/memory-service.js'

/** Render a save outcome as one short report. */
export function formatSaveOutcome(outcome: SaveOutcome): string {
  if (outcome.action === 'reject') {
    return `Memory not saved: ${outcome.reason}.`
  }
  const entry = outcome.entry
  if (entry === undefined) return `Memory ${outcome.action}: ${outcome.reason}.`
  if (outcome.action === 'merge') {
    return `Merged into existing memory \`${outcome.mergedInto}\` (now v${entry.version}, confidence ${entry.confidence.toFixed(2)}).`
  }
  if (outcome.action === 'supersede') {
    return `Saved \`${entry.id}\` and archived the contradicted memory: ${entry.title}.`
  }
  return `Saved \`${entry.id}\` [${entry.kind}] ${entry.title} (confidence ${entry.confidence.toFixed(2)}).`
}

/** Register the save tool on the calling context. */
export function registerMemorySave(ctx: Context, getService: ServiceProvider): void {
  ctx.tools.register(defineTool({
    name: 'memory_save',
    description: [
      'Store one durable memory about the user, the project, or a decision.',
      'Save only information that will still be useful in a future session;',
      'do not save transient task state, secrets, or speculation.',
    ].join(' '),
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The memory itself, written as a self-contained sentence.',
      },
      title: {
        type: 'string',
        description: 'Short label; derived from content when omitted.',
      },
      kind: {
        type: 'string',
        description: 'identity | preference | fact | decision | procedure | episode (default: fact).',
      },
      scope: {
        type: 'string',
        description: 'global (about the user) or project (about this workspace); default: project.',
      },
      tags: {
        type: 'string',
        description: 'Optional comma-separated tags.',
      },
      importance: {
        type: 'number',
        description: '0..1 — how much this should influence future work (default 0.5).',
      },
      subject: {
        type: 'string',
        description: 'Optional structured subject, e.g. "package-manager".',
      },
      predicate: {
        type: 'string',
        description: 'Optional structured predicate, e.g. "is".',
      },
      value: {
        type: 'string',
        description: 'Optional structured value, e.g. "pnpm".',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const service = await getService()
      const kindValue = typeof args.kind === 'string' ? args.kind.trim().toLowerCase() : ''
      const scopeValue = typeof args.scope === 'string' ? args.scope.trim().toLowerCase() : ''
      const kind: MemoryKind | undefined = isMemoryKind(kindValue) ? kindValue : undefined
      const scope: MemoryScope | undefined = isMemoryScope(scopeValue) ? scopeValue : undefined
      const candidate: MemoryCandidate = { content: typeof args.content === 'string' ? args.content : '' }
      if (typeof args.title === 'string' && args.title.trim().length > 0) candidate.title = args.title
      if (kind !== undefined) candidate.kind = kind
      if (scope !== undefined) candidate.scope = scope
      if (typeof args.tags === 'string' && args.tags.trim().length > 0) {
        candidate.tags = args.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
      }
      if (typeof args.importance === 'number') candidate.importance = args.importance
      if (typeof args.subject === 'string') candidate.subject = args.subject
      if (typeof args.predicate === 'string') candidate.predicate = args.predicate
      if (typeof args.value === 'string') candidate.value = args.value

      const outcome = await service.save({ candidate })
      return formatSaveOutcome(outcome)
    },
  }))
}
