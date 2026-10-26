/**
 * `memory_status` — report storage health and memory composition.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStatusReport, ServiceProvider } from '../services/memory-service.js'

/** Render a status report as Markdown. */
export function formatStatus(report: MemoryStatusReport): string {
  const kinds = Object.entries(report.byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(', ')
  return [
    '## Smart memory status',
    '',
    `- records: ${report.total} (${report.active} active, ${report.archived} archived, ${report.forgotten} forgotten)`,
    `- average active confidence: ${report.averageConfidence.toFixed(2)}`,
    `- kinds: ${kinds.length === 0 ? '(none)' : kinds}`,
    `- content size: ${report.totalChars} characters`,
    `- storage: ${report.driver} — \`${report.location}\``,
    `- last update: ${report.lastUpdatedAt ?? '(never)'}`,
  ].join('\n')
}

/** Register the status tool on the calling context. */
export function registerMemoryStatus(ctx: Context, getService: ServiceProvider): void {
  ctx.tools.register(defineTool({
    name: 'memory_status',
    description: 'Report how many memories are stored, their kinds, confidence, and storage backend.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const service = await getService()
      return formatStatus(service.status())
    },
  }))
}
