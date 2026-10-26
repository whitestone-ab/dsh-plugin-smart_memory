/**
 * Periodic consolidation. The timer is owned by a Cordis effect, so unloading
 * the plugin always clears it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LoggerLike, ServiceProvider } from '../services/memory-service.js'

export interface ConsolidationTriggerOptions {
  /** Minutes between consolidation passes; 0 disables the trigger. */
  intervalMinutes: number
  logger?: LoggerLike
}

/** Install the periodic consolidation trigger. */
export function installConsolidationTrigger(
  ctx: Context,
  getService: ServiceProvider,
  options: ConsolidationTriggerOptions,
): void {
  if (!Number.isFinite(options.intervalMinutes) || options.intervalMinutes <= 0) return
  const periodMs = Math.max(60_000, Math.round(options.intervalMinutes * 60_000))

  ctx.effect(() => {
    let running = false
    const timer = setInterval(() => {
      if (running) return
      running = true
      void getService()
        .then(service => service.consolidate())
        .catch((error: unknown) => {
          options.logger?.warn(`smart-memory consolidation failed: ${String(error)}`)
        })
        .finally(() => {
          running = false
        })
    }, periodMs)
    timer.unref()
    return () => {
      clearInterval(timer)
    }
  })
}
