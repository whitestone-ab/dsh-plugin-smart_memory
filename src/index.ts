/**
 * Smart memory — persistent, policy-driven memory for DeepSeek Harness.
 *
 * The plugin is a thin composition layer: it opens one {@link MemoryService},
 * registers the model tools, a native command set, a system-prompt section, and
 * (optionally) session capture plus periodic consolidation.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { MemorySection } from './context/memory-section.js'
import { DEFAULT_INJECTION_POLICY } from './context/injection-policy.js'
import type { InjectionPolicy } from './context/injection-policy.js'
import { registerMemoryCommands } from './commands/memory-commands.js'
import { installConsolidationTrigger } from './lifecycle/consolidation-trigger.js'
import { installSessionCapture, SessionCapture } from './lifecycle/session-capture.js'
import { recallForTask } from './lifecycle/task-recall.js'
import type { LoggerLike, ServiceProvider } from './services/memory-service.js'
import { MemoryService } from './services/memory-service.js'
import { registerMemoryExport } from './tools/memory-export.js'
import { registerMemoryForget } from './tools/memory-forget.js'
import { registerMemoryRecall } from './tools/memory-recall.js'
import { registerMemorySave } from './tools/memory-save.js'
import { registerMemoryStatus } from './tools/memory-status.js'

/**
 * Plugin id — must equal the `id` in cordis.patch.yml exactly.
 */
export const name = 'smart-memory'

/** Services that must be ready before apply() runs. */
export const inject = ['tools', 'systemPrompt', 'commands']

export interface Config {
  /**
   * Directory (or `.sqlite`/`.json` file stem) for the memory database.
   * Empty uses `$DSH_HOME/smart-memory`.
   */
  storagePath: string
  /** Maximum memories returned by recall/injection. */
  recallLimit: number
  /** Soft character budget for the injected memory section. */
  injectBudgetChars: number
  /** Minimum confidence for a new memory to be stored. */
  minConfidence: number
  /** Persist memories parsed from session traffic. */
  autoCapture: boolean
  /** Run periodic consolidation. */
  autoConsolidate: boolean
  /** Minutes between consolidation passes. */
  consolidationIntervalMinutes: number
  /** Upper bound on captured request text. */
  captureMaxChars: number
}

export const Config: Schema<Config> = Schema.object({
  storagePath: Schema.string().default('')
    .description('Directory or file stem for the memory database. Empty = $DSH_HOME/smart-memory.'),
  recallLimit: Schema.number().default(8)
    .description('Maximum number of memories recalled or injected.'),
  injectBudgetChars: Schema.number().default(1_200)
    .description('Soft character budget for the injected memory section.'),
  minConfidence: Schema.number().default(0.35)
    .description('Minimum confidence required to store a new memory.'),
  autoCapture: Schema.boolean().default(false)
    .description('Persist memory statements detected in session traffic.'),
  autoConsolidate: Schema.boolean().default(true)
    .description('Run memory consolidation periodically.'),
  consolidationIntervalMinutes: Schema.number().default(60)
    .description('Minutes between consolidation passes.'),
  captureMaxChars: Schema.number().default(4_000)
    .description('Maximum captured user-request length used for task recall.'),
})

/** Resolve the configured storage location to an absolute path. */
function resolveStoragePath(configured: string): string {
  const trimmed = configured.trim()
  if (trimmed.length > 0) return resolve(trimmed)
  const configuredHome = process.env.DSH_HOME?.trim()
  const home = configuredHome !== undefined && configuredHome.length > 0
    ? configuredHome
    : join(homedir(), '.dsh')
  return join(home, 'smart-memory')
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger(name) as LoggerLike
  const storagePath = resolveStoragePath(config.storagePath)

  let ready: MemoryService | undefined
  const pending = MemoryService.create({
    storagePath,
    recallLimit: config.recallLimit,
    minConfidence: config.minConfidence,
    logger,
  }).then((service) => {
    ready = service
    return service
  })
  pending.catch((error: unknown) => {
    logger.error(`smart-memory failed to open its store: ${String(error)}`)
  })

  const getService: ServiceProvider = () => pending

  const policy: InjectionPolicy = {
    budgetChars: config.injectBudgetChars,
    maxItems: config.recallLimit,
    kindPriority: DEFAULT_INJECTION_POLICY.kindPriority,
  }
  const section = new MemorySection({
    policy,
    getHits: () => {
      const service = ready
      if (service === undefined) return []
      const task = service.lastTask
      return task.length > 0
        ? recallForTask(service, task, config.recallLimit)
        : service.highlights(config.recallLimit)
    },
  })
  section.register(ctx)

  registerMemoryRecall(ctx, getService)
  registerMemorySave(ctx, getService)
  registerMemoryForget(ctx, getService)
  registerMemoryStatus(ctx, getService)
  registerMemoryExport(ctx, getService)
  registerMemoryCommands(ctx, getService)

  const capture = new SessionCapture({
    persist: config.autoCapture,
    maxChars: config.captureMaxChars,
    onUserText: (text) => {
      if (ready !== undefined) ready.lastTask = text
    },
    onMemory: async (candidate, evidence) => {
      const service = await getService()
      return service.save({ candidate, evidence })
    },
    logger,
  })
  installSessionCapture(ctx, capture, logger)

  if (config.autoConsolidate) {
    installConsolidationTrigger(ctx, getService, {
      intervalMinutes: config.consolidationIntervalMinutes,
      logger,
    })
  }

  ctx.effect(() => () => {
    void pending
      .then(service => service.close())
      .catch(() => undefined)
  })
}
