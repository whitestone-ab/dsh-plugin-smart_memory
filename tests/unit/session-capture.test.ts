import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionCapture, extractMemories } from '../../src/lifecycle/session-capture.js'

test('ignores unknown event types instead of treating them as user input', () => {
  const observed: string[] = []

  const capture = new SessionCapture({
    persist: false,
    maxChars: 4000,
    onUserText: text => observed.push(text),
  })

  capture.observe({
    type: 'turn/end',
    data: {
      text: 'This is internal event data, not a user prompt.',
    },
  })

  assert.deepEqual(observed, [])
})

test('tracks user messages even when automatic persistence is disabled', () => {
  const observed: string[] = []

  const capture = new SessionCapture({
    persist: false,
    maxChars: 4000,
    onUserText: text => observed.push(text),
  })

  capture.observe({
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'user' },
      content: [
        {
          type: 'text',
          text: 'Please explain the memory architecture.',
        },
      ],
    },
  })

  assert.deepEqual(observed, [
    'Please explain the memory architecture.',
  ])
})

test('does not mistake assistant prompt events for user input', () => {
  const observed: string[] = []

  const capture = new SessionCapture({
    persist: false,
    maxChars: 4000,
    onUserText: text => observed.push(text),
  })

  capture.observe({
    type: 'assistant/prompt',
    data: {
      text: 'Remember that the internal instruction is not user input.',
    },
  })

  assert.deepEqual(observed, [])
})

test('evidence quote contains the text supporting the captured memory', () => {
  const saved: Array<{
    content: string
    quote?: string
  }> = []

  const prefix = 'Unrelated context. '.repeat(30)
  const input =
    `${prefix}Remember that we use SQLite for persistence.`

  const capture = new SessionCapture({
    persist: true,
    maxChars: 4000,
    onMemory: async (candidate, evidence) => {
      saved.push({
        content: candidate.content,
        quote: evidence[0]?.quote,
      })
    },
  })

  capture.observe({
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: input }],
    },
  })

  assert.equal(saved.length, 1)
  assert.match(saved[0].content, /SQLite/i)
  assert.match(saved[0].quote ?? '', /SQLite/i)
  assert.ok(input.includes(saved[0].quote ?? ''))
})

test('keeps separate statements out of the same extracted memory', () => {
  const input = 'I prefer tabs. We decided to ship on Fridays.'
  const memories = extractMemories(input)

  const preference = memories.find(memory => memory.kind === 'preference')
  const decision = memories.find(memory => memory.kind === 'decision')

  assert.ok(preference !== undefined)
  assert.ok(decision !== undefined)

  // The preference stops at the English sentence boundary.
  assert.doesNotMatch(preference.content, /We decided/)
  assert.match(decision.content, /ship on Fridays/)

  // Each memory keeps its own raw quote, still traceable to the input.
  assert.ok(input.includes(preference.quote))
  assert.ok(input.includes(decision.quote))
  assert.doesNotMatch(preference.quote, /We decided/)
})

test('keeps the supporting text when the trigger is separated by long whitespace', () => {
  const saved: Array<{
    content: string
    quote?: string
  }> = []

  const statement = 'we use SQLite for persistence.'
  const input = `Remember that${' '.repeat(400)}${statement}`

  const capture = new SessionCapture({
    persist: true,
    maxChars: 4000,
    onMemory: async (candidate, evidence) => {
      saved.push({
        content: candidate.content,
        quote: evidence[0]?.quote,
      })
    },
  })

  capture.observe({
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: input }],
    },
  })

  assert.equal(saved.length, 1)
  assert.match(saved[0].content, /SQLite/i)
  assert.ok(saved[0].quote?.includes('SQLite'))
  assert.ok(input.includes(saved[0].quote ?? ''))
})

test('accepts a direct user message with native DSH event shape', () => {
  const observed: string[] = []

  const capture = new SessionCapture({
    persist: false,
    maxChars: 4000,
    onUserText: text => observed.push(text),
  })

  capture.observe({
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'user' },
      content: [
        {
          type: 'text',
          text: 'Please explain the memory architecture.',
        },
      ],
    },
  })

  assert.deepEqual(observed, [
    'Please explain the memory architecture.',
  ])
})

test('ignores runtime context even when its role is user', () => {
  const observed: string[] = []
  const saved: string[] = []

  const capture = new SessionCapture({
    persist: true,
    maxChars: 4000,
    onUserText: text => observed.push(text),
    onMemory: async candidate => {
      saved.push(candidate.content)
    },
  })

  capture.observe({
    type: 'user/message',
    data: {
      role: 'user',
      source: { kind: 'runtime-context' },
      content: [
        {
          type: 'text',
          text: 'Remember that we use SQLite for persistence.',
        },
      ],
    },
  })

  assert.deepEqual(observed, [])
  assert.deepEqual(saved, [])
})

test('rejects user messages without source provenance', () => {
  const observed: string[] = []

  const capture = new SessionCapture({
    persist: false,
    maxChars: 4000,
    onUserText: text => observed.push(text),
  })

  capture.observe({
    type: 'user/message',
    data: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Remember that we use SQLite for persistence.',
        },
      ],
    },
  })

  assert.deepEqual(observed, [])
})
