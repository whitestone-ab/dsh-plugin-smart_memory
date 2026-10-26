import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryService } from '../../src/services/memory-service.js'
import type { MemoryEntry } from '../../src/cognition/schema.js'
import { openPersistence } from '../../src/storage/sqlite-store.js'

async function withService(
  run: (service: MemoryService, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-'))
  const service = await MemoryService.create({ storagePath: dir, minConfidence: 0.3 })
  try {
    await run(service, dir)
  } finally {
    await service.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test('saves, recalls, reports, and exports memories', async () => {
  await withService(async (service) => {
    const outcome = await service.save({
      candidate: {
        content: 'The project uses pnpm for package management.',
        kind: 'fact',
        tags: ['tooling'],
        subject: 'package-manager',
        predicate: 'is',
        value: 'pnpm',
      },
    })
    assert.equal(outcome.action, 'insert')

    const hits = await service.recall({ text: 'pnpm package manager' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.entry.value, 'pnpm')
    assert.equal(hits[0]?.entry.accessCount, 1)

    const status = service.status()
    assert.equal(status.total, 1)
    assert.equal(status.active, 1)
    assert.equal(status.byKind.fact, 1)

    const exported = JSON.parse(service.exportRecords('json')) as { entries: unknown[] }
    assert.equal(exported.entries.length, 1)
  })
})

test('reopening the store preserves records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-'))
  try {
    const first = await MemoryService.create({ storagePath: dir, minConfidence: 0.3 })
    await first.save({ candidate: { content: 'The test command is pnpm test.', kind: 'procedure' } })
    await first.close()

    const second = await MemoryService.create({ storagePath: dir, minConfidence: 0.3 })
    const hits = await second.recall({ text: 'test command' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.entry.kind, 'procedure')
    await second.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('superseding archives the contradicted memory', async () => {
  await withService(async (service) => {
    await service.save({
      candidate: {
        content: 'The package manager is npm.',
        subject: 'pm',
        predicate: 'is',
        value: 'npm',
      },
    })
    const outcome = await service.save({
      candidate: {
        content: 'The package manager is pnpm.',
        subject: 'pm',
        predicate: 'is',
        value: 'pnpm',
      },
      confidence: 0.9,
    })
    assert.equal(outcome.action, 'supersede')

    const status = service.status()
    assert.equal(status.total, 2)
    assert.equal(status.active, 1)
    assert.equal(status.archived, 1)

    const hits = service.recallSync({ text: 'package manager' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.entry.value, 'pnpm')
  })
})

test('forget archives and delete removes', async () => {
  await withService(async (service) => {
    const saved = await service.save({ candidate: { content: 'Remember the deploy checklist.' } })
    assert.ok(saved.entry !== undefined)
    const id = saved.entry.id

    const archived = await service.forget(id)
    assert.equal(archived?.status, 'archived')
    assert.equal(service.status().active, 0)

    const deleted = await service.forget(id, 'delete')
    assert.equal(deleted?.status, 'forgotten')
    assert.equal(service.status().total, 0)
  })
})

test('near-duplicate saves are merged instead of appended', async () => {
  await withService(async (service) => {
    await service.save({ candidate: { content: 'Deploy with docker compose on the staging host.' } })
    const second = await service.save({
      candidate: { content: 'Deploy with docker compose on the staging host machine.' },
    })
    assert.equal(second.action, 'merge')
    assert.equal(service.status().total, 1)
  })
})

test('consolidation does not promote an archived duplicate episode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-consolidate-'))

  try {
    // Seed two duplicate episodes directly into persistence.
    // This avoids save-policy merging them before consolidation runs.
    const persistence = await openPersistence(join(dir, 'memory'))

    const makeEpisode = (
      id: string,
      createdAt: string,
      accessCount: number,
    ): MemoryEntry => ({
      id,
      kind: 'episode',
      scope: 'project',
      title: 'Deployment workflow',
      content: 'The staging deployment uses Docker Compose with a release checklist.',
      tags: ['deployment'],
      evidence: [{ source: 'user', at: createdAt }],
      confidence: 0.9,
      importance: 0.5,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      lastAccessedAt: createdAt,
      accessCount,
      version: 1,
    })

    try {
      await persistence.save(
        makeEpisode('mem_a', '2026-01-01T00:00:00.000Z', 0),
      )
      await persistence.save(
        makeEpisode('mem_b', '2026-01-02T00:00:00.000Z', 3),
      )
    } finally {
      await persistence.close()
    }

    const service = await MemoryService.create({
      storagePath: dir,
      minConfidence: 0.3,
    })

    try {
      const report = await service.consolidate(
        new Date('2026-10-26T00:00:00.000Z'),
      )

      const exported = JSON.parse(
        service.exportRecords('json'),
      ) as { entries: MemoryEntry[] }

      const archivedDuplicate = exported.entries.find(
        entry => entry.id === 'mem_b',
      )

      // A duplicate archived during consolidation must not be promoted.
      assert.equal(archivedDuplicate?.status, 'archived')
      assert.equal(archivedDuplicate?.kind, 'episode')
      assert.equal(report.promoted, 0)
    } finally {
      await service.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('consolidation keeps similar memories from different projects separate', async () => {
  await withService(async (service) => {
    const content =
      'The staging deployment uses Docker Compose with a release checklist.'

    const first = await service.save({
      candidate: {
        content,
        kind: 'episode',
        scope: 'project',
        projectPath: 'D:\\work\\project-a',
      },
      confidence: 0.9,
    })

    const second = await service.save({
      candidate: {
        content,
        kind: 'episode',
        scope: 'project',
        projectPath: 'D:\\work\\project-b',
      },
      confidence: 0.9,
    })

    assert.equal(first.action, 'insert')
    assert.equal(second.action, 'insert')
    assert.equal(service.status().active, 2)

    const report = await service.consolidate(
      new Date('2026-10-27T00:00:00.000Z'),
    )

    assert.equal(report.mergedGroups, 0)
    assert.equal(service.status().total, 2)
    assert.equal(service.status().active, 2)
  })
})

test('evidence survives a merge and reopening the store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smart-memory-evidence-'))

  const quoteA = 'Deploy with docker compose on the staging host.'
  const quoteB = 'We also deploy with docker compose on the staging host machine.'

  try {
    const first = await MemoryService.create({
      storagePath: dir,
      minConfidence: 0.3,
    })

    let mergedId = ''
    const mergedEntry = async () => {
      const parsed = JSON.parse(first.exportRecords('json')) as {
        entries: MemoryEntry[]
      }
      return parsed.entries.find(entry => entry.id === mergedId)
    }

    try {
      const a = await first.save({
        candidate: { content: quoteA },
        evidence: [{
          source: 'user',
          at: '2026-01-01T00:00:00.000Z',
          quote: quoteA,
        }],
      })
      assert.equal(a.action, 'insert')

      const b = await first.save({
        candidate: { content: quoteB },
        evidence: [{
          source: 'user',
          at: '2026-01-02T00:00:00.000Z',
          quote: quoteB,
        }],
      })
      assert.equal(b.action, 'merge')
      mergedId = b.entry?.id ?? ''
      assert.ok(mergedId.length > 0)
      assert.equal(b.entry?.id, a.entry?.id)

      const merged = await mergedEntry()
      assert.ok(merged !== undefined)
      // Both sources survive the merge, in insertion order.
      assert.deepEqual(merged.evidence.map(item => item.quote), [quoteA, quoteB])
      // Evidence stays in `evidence`, not in the memory body.
      assert.ok(!('quote' in merged))
      assert.equal(merged.content, quoteB)
    } finally {
      await first.close()
    }

    const reopened = await MemoryService.create({
      storagePath: dir,
      minConfidence: 0.3,
    })

    try {
      const parsed = JSON.parse(reopened.exportRecords('json')) as {
        entries: MemoryEntry[]
      }
      assert.equal(parsed.entries.length, 1)
      const entry = parsed.entries[0]
      assert.ok(entry !== undefined)
      assert.equal(entry.id, mergedId)
      assert.deepEqual(entry.evidence.map(item => item.quote), [quoteA, quoteB])
      assert.ok(!('quote' in entry))
    } finally {
      await reopened.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
