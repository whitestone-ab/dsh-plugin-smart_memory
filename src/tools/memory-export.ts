/**
 * `memory_export` — export every record as JSON or Markdown, optionally to a file.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ServiceProvider } from '../services/memory-service.js'

/** Register the export tool on the calling context. */
export function registerMemoryExport(ctx: Context, getService: ServiceProvider): void {
  ctx.tools.register(defineTool({
    name: 'memory_export',
    description: [
      'Export all stored memories as JSON or Markdown.',
      'Without a path the content is returned directly;',
      'with a path it is also written to that file (parent directories are created).',
    ].join(' '),
    parameters: {
      format: {
        type: 'string',
        description: 'json (default) or markdown.',
      },
      path: {
        type: 'string',
        description: 'Optional absolute or workspace-relative output file.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const service = await getService()
      const format = args.format === 'markdown' ? 'markdown' : 'json'
      const content = service.exportRecords(format)
      const target = typeof args.path === 'string' ? args.path.trim() : ''
      if (target.length === 0) return content
      const absolute = resolve(target)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, content, 'utf8')
      return `Exported ${format} memory data to \`${absolute}\` (${content.length} characters).`
    },
  }))
}
