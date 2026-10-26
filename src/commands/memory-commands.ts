/**
 * Native human commands (`/memory-…`). Commands never reach the model; they
 * operate on the store directly and return a short result for the UI.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { MemoryEvidence } from '../cognition/schema.js'
import type { ServiceProvider } from '../services/memory-service.js'
import { formatHits } from '../tools/memory-recall.js'
import { formatSaveOutcome } from '../tools/memory-save.js'
import { formatStatus } from '../tools/memory-status.js'

/** Split raw command input into whitespace-separated arguments. */
function argumentsOf(rawInput: string): string[] {
  return rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
}

/** Register every memory command on the calling context. */
export function registerMemoryCommands(ctx: Context, getService: ServiceProvider): void {
  ctx.commands.register({
    name: 'memory-status',
    description: 'Show smart-memory health, record counts, and storage backend.',
    async handler(): Promise<CommandResult> {
      const service = await getService()
      return { kind: 'success', text: formatStatus(service.status()) }
    },
  })

  ctx.commands.register({
    name: 'memory-recall',
    description: 'Search stored memories; with no argument, recall memories for the current task.',
    input: { hint: '[query]' },
    async handler(invocation): Promise<CommandResult> {
      const service = await getService()
      const query = invocation.rawInput.trim()
      const hits = query.length === 0
        ? service.recallSync({ text: service.lastTask, limit: 8 })
        : await service.recall({ text: query, limit: 8 })
      return { kind: 'success', text: formatHits(hits, query) }
    },
  })

  ctx.commands.register({
    name: 'memory-save',
    description: 'Store one durable memory from the command line.',
    input: { hint: '<content>' },
    async handler(invocation): Promise<CommandResult> {
      const content = invocation.rawInput.trim()
      if (content.length === 0) {
        return { kind: 'error', text: 'Usage: /memory-save <content>' }
      }
      const service = await getService()
      const evidence: MemoryEvidence[] = [{
        source: 'user',
        at: new Date().toISOString(),
        quote: content.slice(0, 300),
      }]
      const outcome = await service.save({
        candidate: { content, kind: 'fact', tags: ['command'] },
        evidence,
        confidence: 0.85,
      })
      return { kind: 'success', text: formatSaveOutcome(outcome) }
    },
  })

  ctx.commands.register({
    name: 'memory-forget',
    description: 'Archive or delete a memory: /memory-forget <id> [archive|delete].',
    input: { hint: '<id> [archive|delete]' },
    async handler(invocation): Promise<CommandResult> {
      const parts = argumentsOf(invocation.rawInput)
      const id = parts[0]
      if (id === undefined) {
        return { kind: 'error', text: 'Usage: /memory-forget <id> [archive|delete]' }
      }
      const mode = parts[1] === 'delete' ? 'delete' : 'archive'
      const service = await getService()
      const result = await service.forget(id, mode)
      if (result === undefined) {
        return { kind: 'error', text: `No memory found with id "${id}".` }
      }
      return {
        kind: 'success',
        text: mode === 'delete'
          ? `Deleted memory ${id} (${result.title}).`
          : `Archived memory ${id} (${result.title}).`,
      }
    },
  })

  ctx.commands.register({
    name: 'memory-export',
    description: 'Export all memories as JSON or Markdown: /memory-export [json|markdown] [path].',
    input: { hint: '[json|markdown] [path]' },
    async handler(invocation): Promise<CommandResult> {
      const parts = argumentsOf(invocation.rawInput)
      const format = parts[0] === 'markdown' ? 'markdown' : 'json'
      const path = parts[0] === 'markdown' || parts[0] === 'json' ? parts[1] : parts[0]
      const service = await getService()
      const content = service.exportRecords(format)
      if (path === undefined) {
        return { kind: 'success', text: content }
      }
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { dirname, resolve } = await import('node:path')
      const absolute = resolve(path)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, content, 'utf8')
      return { kind: 'success', text: `Exported ${format} memory data to ${absolute}.` }
    },
  })
}
