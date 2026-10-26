/**
 * Contributes the memory section to the model's system prompt.
 *
 * The section is evaluated on every assembly. Double braces are broken before
 * rendering because prompt interpolation treats `{{name}}` as a variable and
 * would fail on user-authored memory text.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { RecallHit } from '../cognition/schema.js'
import type { InjectionPolicy } from './injection-policy.js'
import { renderMemorySection } from './injection-policy.js'

/** Neutralize prompt-variable syntax without changing the visible text much. */
function escapePromptBraces(text: string): string {
  return text.replace(/\{\{/gu, '{ {')
}

/** Options for {@link MemorySection}. */
export interface MemorySectionOptions {
  /** Unique prompt-section name. */
  name?: string
  /** Placement order; 8500 keeps memory near the end of the stable prompt. */
  order?: number
  policy: InjectionPolicy
  /** Called synchronously on every prompt assembly. */
  getHits: () => readonly RecallHit[]
}

export class MemorySection {
  constructor(private readonly options: MemorySectionOptions) {}

  /** Register the section; disposal is owned by the calling context. */
  register(ctx: Context): void {
    ctx.systemPrompt.section({
      name: this.options.name ?? 'memory:smart-memory',
      order: this.options.order ?? 8_500,
      text: () => escapePromptBraces(this.render()),
    })
  }

  /** @returns the section text for the current store contents. */
  render(): string {
    return renderMemorySection(this.options.getHits(), this.options.policy)
  }
}
