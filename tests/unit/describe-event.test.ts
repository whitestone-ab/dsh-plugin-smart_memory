/**
 * Tests for the opt-in `session/event` metadata diagnostic in session-capture.
 *
 * `describeEvent` is module-private, so the diagnostic is exercised through its
 * only production entry point: `installSessionCapture` + `DSH_SMART_MEMORY_DEBUG=1`.
 * The assertions deliberately cover two promises made by the implementation:
 *   1. the description is metadata-only — message bodies never appear;
 *   2. malformed events degrade to `missing`/`none` placeholders instead of
 *      throwing, because session payloads are untrusted and may evolve.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionCapture, installSessionCapture } from '../../src/lifecycle/session-capture.js'
import type { LoggerLike } from '../../src/services/memory-service.js'

const DEBUG_ENV = 'DSH_SMART_MEMORY_DEBUG'

interface Harness {
  /** Deliver one `(session, event)` pair to the registered listener. */
  emit(event: unknown): void
  /** Metadata diagnostics captured at `logger.info`. */
  info: string[]
  /** Warnings captured at `logger.warn` (and `logger.error`, for safety). */
  warn: string[]
}

/** Build a capture wired to a fake event bus and a recording logger. */
function harness(): Harness {
  const info: string[] = []
  const warn: string[] = []
  const logger: LoggerLike = {
    info: (message: string) => { info.push(message) },
    warn: (message: string) => { warn.push(message) },
    error: (message: string) => { warn.push(message) },
  }
  let listener: ((...args: unknown[]) => void) | undefined
  const ctx = {
    on(name: string, fn: (...args: unknown[]) => void): unknown {
      assert.equal(name, 'session/event')
      listener = fn
    },
  }
  installSessionCapture(
    ctx as unknown as Parameters<typeof installSessionCapture>[0],
    new SessionCapture({ persist: false, maxChars: 10_000 }),
    logger,
  )
  return {
    info,
    warn,
    emit(event: unknown): void {
      assert.ok(listener !== undefined, 'session/event listener was registered')
      listener(undefined, event)
    },
  }
}

/** Run `body` with the debug switch in a known state, then restore it. */
function withDebug<T>(enabled: boolean, body: () => T): T {
  const previous = process.env[DEBUG_ENV]
  if (enabled) process.env[DEBUG_ENV] = '1'
  else delete process.env[DEBUG_ENV]
  try {
    return body()
  } finally {
    if (previous === undefined) delete process.env[DEBUG_ENV]
    else process.env[DEBUG_ENV] = previous
  }
}

test('describeEvent emits metadata only, never the message body', () => {
  const events = harness()
  const secret = 'S3CR3T-ORBIT-73-body'
  withDebug(true, () => {
    events.emit({
      type: 'user/message',
      data: {
        role: 'user',
        source: { kind: 'user' },
        content: [
          { type: 'text', text: `please remember ${secret}` },
          { type: 'image', url: `https://example.com/${secret}.png` },
        ],
      },
    })
  })

  assert.equal(events.warn.length, 0)
  assert.equal(events.info.length, 1)
  const line = events.info[0]
  assert.equal(
    line,
    '[smart-memory] event=user/message role=user source=user blocks=text,image',
  )
  // The body and any substring of it must not survive into the diagnostic.
  assert.ok(!line.includes(secret), 'message body leaked into the metadata line')
  assert.ok(!line.includes('S3CR3T'), 'message body leaked into the metadata line')
  assert.ok(!line.includes('please remember'), 'message body leaked into the metadata line')
})

test('describeEvent degrades malformed events to missing/none instead of throwing', () => {
  const cases: Array<{ name: string; event: unknown; expected: string }> = [
    {
      name: 'null event',
      event: null,
      expected: '[smart-memory] event=undefined role=missing source=missing blocks=none',
    },
    {
      name: 'undefined event',
      event: undefined,
      expected: '[smart-memory] event=undefined role=missing source=missing blocks=none',
    },
    {
      name: 'object without data',
      event: { type: 'user/message' },
      expected: '[smart-memory] event=user/message role=missing source=missing blocks=none',
    },
    {
      name: 'data is a string',
      event: { type: 'user/message', data: 'plain string body' },
      expected: '[smart-memory] event=user/message role=missing source=missing blocks=none',
    },
    {
      name: 'data is an array',
      event: { type: 'user/message', data: [] },
      expected: '[smart-memory] event=user/message role=missing source=missing blocks=none',
    },
    {
      name: 'content is not an array',
      event: { type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: 'text' } },
      expected: '[smart-memory] event=user/message role=user source=user blocks=none',
    },
    {
      name: 'content entries lack a string type',
      event: {
        type: 'user/message',
        data: {
          role: 'user',
          source: { kind: 'assistant' },
          content: [null, 7, { type: 42 }, { type: 'text' }],
        },
      },
      expected: '[smart-memory] event=user/message role=user source=assistant'
        + ' blocks=unknown,unknown,unknown,text',
    },
    {
      name: 'event type is not a string',
      event: { type: 42 },
      expected: '[smart-memory] event=42 role=missing source=missing blocks=none',
    },
  ]

  for (const { name, event, expected } of cases) {
    const events = harness()
    withDebug(true, () => {
      assert.doesNotThrow(() => events.emit(event), `${name}: listener must not throw`)
    })
    assert.equal(events.warn.length, 0, `${name}: no warning expected`)
    assert.equal(events.info.length, 1, `${name}: exactly one diagnostic line`)
    assert.equal(events.info[0], expected, `${name}: placeholder shape`)
  }
})

test('describeEvent stays silent unless DSH_SMART_MEMORY_DEBUG=1', () => {
  const events = harness()
  withDebug(false, () => {
    events.emit({
      type: 'user/message',
      data: {
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'quiet body' }],
      },
    })
  })

  assert.equal(events.info.length, 0)
  assert.equal(events.warn.length, 0)
})
