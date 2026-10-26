import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { MemoryService } from '../../src/services/memory-service.js'

async function withService<T>(fn: (service: MemoryService) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-placeholder-'))
  try {
    const service = await MemoryService.create({ storagePath: dir })
    try {
      return await fn(service)
    } finally {
      await service.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('saving without evidence records an inference placeholder, not assistant', async () => {
  await withService(async (service) => {
    const outcome = await service.save({
      candidate: { content: 'A fact saved without explicit evidence.', kind: 'fact' },
    })
    assert.notEqual(outcome.action, 'reject')
    const entry = outcome.entry
    assert.ok(entry, 'expected a stored entry')
    assert.equal(entry.evidence.length, 1)
    assert.equal(entry.evidence[0]!.source, 'inference')
    assert.equal(entry.evidence[0]!.quote, undefined)
  })
})

test('a no-evidence save still inserts under the default confidence gate', async () => {
  await withService(async (service) => {
    const outcome = await service.save({
      candidate: { content: 'Another fact without explicit evidence.', kind: 'fact' },
    })
    assert.equal(outcome.action, 'insert')
    assert.ok(outcome.entry)
    assert.ok(
      outcome.entry.confidence > 0.35,
      `expected confidence above the default gate, got ${outcome.entry.confidence}`,
    )
  })
})
