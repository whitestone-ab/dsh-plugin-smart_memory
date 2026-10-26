import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { MemoryService } from '../../src/services/memory-service.js'

function isoAt(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString()
}

const SAVE_BASE = {
  content: 'The project uses pnpm for package management.',
  kind: 'fact' as const,
  scope: 'project' as const,
}

async function seedTwentyFive(service: MemoryService): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const outcome = await service.save({
      candidate: SAVE_BASE,
      evidence: [{ source: 'user', at: isoAt(i), quote: `q-${i}` }],
      confidence: 0.9,
    })
    assert.notEqual(outcome.action, 'reject', `save ${i} was rejected: ${outcome.reason}`)
    if (i === 0) assert.equal(outcome.action, 'insert')
    else assert.equal(outcome.action, 'merge')
  }
}

function assertBoundedEvidence(quotes: (string | undefined)[]): void {
  assert.equal(quotes.length, 20)
  for (let i = 0; i < 5; i += 1) {
    assert.ok(quotes.includes(`q-${i}`), `missing oldest q-${i}`)
  }
  for (let i = 10; i < 25; i += 1) {
    assert.ok(quotes.includes(`q-${i}`), `missing newest q-${i}`)
  }
  for (let i = 5; i < 10; i += 1) {
    assert.ok(!quotes.includes(`q-${i}`), `middle q-${i} should have been dropped`)
  }
}

test('a real save/merge cycle keeps 20 evidence items across a store reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-evidence-cap-'))
  try {
    let service = await MemoryService.create({ storagePath: dir })
    try {
      await seedTwentyFive(service)
      const hits = service.recallSync({ text: 'pnpm' })
      assert.equal(hits.length, 1)
      const entry = hits[0]!.entry
      assert.equal(entry.version, 25)
      assertBoundedEvidence(entry.evidence.map(item => item.quote))
      const ats = entry.evidence.map(item => item.at)
      assert.deepEqual(ats, [...ats].sort())
    } finally {
      await service.close()
    }

    service = await MemoryService.create({ storagePath: dir })
    try {
      const hits = service.recallSync({ text: 'pnpm' })
      assert.equal(hits.length, 1)
      assertBoundedEvidence(hits[0]!.entry.evidence.map(item => item.quote))
      const ats = hits[0]!.entry.evidence.map(item => item.at)
      assert.deepEqual(ats, [...ats].sort())
    } finally {
      await service.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
