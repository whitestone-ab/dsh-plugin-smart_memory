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

test('real evidence replaces the placeholder and stays stable across a reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-placeholder-'))
  const content = 'Deploys use Docker Compose.'

  try {
    let service = await MemoryService.create({ storagePath: dir })

    try {
      const first = await service.save({ candidate: { content, kind: 'fact' } })
      assert.equal(first.action, 'insert')
      assert.equal(first.entry?.evidence.length, 1)
      assert.equal(first.entry?.evidence[0]?.source, 'inference')
      assert.equal(first.entry?.evidence[0]?.quote, undefined)

      const quote = 'Deploys use Docker Compose on the staging host.'
      const second = await service.save({
        candidate: { content, kind: 'fact' },
        evidence: [{ source: 'user', at: '2026-02-01T00:00:00.000Z', quote }],
      })
      assert.equal(second.action, 'merge')
      assert.deepEqual(second.entry?.evidence.map(item => item.quote), [quote])
    } finally {
      await service.close()
    }

    service = await MemoryService.create({ storagePath: dir })

    try {
      const reopened = service.recallSync({ text: 'Docker Compose' })
      assert.equal(reopened.length, 1)
      assert.deepEqual(
        reopened[0]!.entry.evidence.map(item => item.quote),
        ['Deploys use Docker Compose on the staging host.'],
      )

      // A later no-evidence save must not reintroduce a placeholder.
      const third = await service.save({
        candidate: { content, kind: 'fact' },
        evidence: [{ source: 'user', at: '2026-02-02T00:00:00.000Z', quote: 'Staging deploys use Docker Compose.' }],
      })
      assert.equal(third.action, 'merge')
      assert.deepEqual(
        third.entry?.evidence.map(item => item.quote),
        ['Deploys use Docker Compose on the staging host.', 'Staging deploys use Docker Compose.'],
      )
    } finally {
      await service.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
