/**
 * `memory_forget` — archive or permanently delete one memory record.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ServiceProvider } from '../services/memory-service.js'

/** Register the forget tool on the calling context. */
export function registerMemoryForget(ctx: Context, getService: ServiceProvider): void {
  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: [
      'Archive or delete a stored memory by id.',
      'Use archive (the default) when the memory is merely outdated;',
      'delete only when the user explicitly asks for permanent removal.',
    ].join(' '),
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Memory id, as returned by memory_recall or memory_status.',
      },
      mode: {
        type: 'string',
        description: 'archive (default) keeps a tombstone; delete removes the record permanently.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const service = await getService()
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const rawMode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : ''
      const mode = rawMode === 'delete' ? 'delete' : 'archive'
      if (id.length === 0) return 'No memory id supplied.'
      const result = await service.forget(id, mode)
      if (result === undefined) return `No memory found with id \`${id}\`.`
      return mode === 'delete'
        ? `Deleted memory \`${id}\` (${result.title}).`
        : `Archived memory \`${id}\` (${result.title}); it is no longer injected or recalled.`
    },
  }))
}
