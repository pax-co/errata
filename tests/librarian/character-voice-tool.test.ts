import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory, createFragment, getFragment } from '@/server/fragments/storage'
import type { Fragment } from '@/server/fragments/schema'
import { createSetCharacterVoiceTool } from '@/server/librarian/character-voice-tool'

function makeCharacter(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'ch-000001',
    type: 'character',
    name: 'Maya',
    description: 'The protagonist',
    content: 'A detective with a dry wit.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    ...overrides,
  }
}

describe('setCharacterVoice tool', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-voice-tool'
  let execute: ReturnType<typeof createSetCharacterVoiceTool>['execute']

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await createStory(dataDir, {
      id: storyId,
      name: 'Test Story',
      description: 'A test story',
      coverImage: null,
      summary: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings: makeTestSettings(),
    })
    await createFragment(dataDir, storyId, makeCharacter({ id: 'ch-maya01', name: 'Maya' }))
    await createFragment(dataDir, storyId, makeCharacter({
      id: 'ch-lock01',
      name: 'Locked Char',
      meta: { locked: true },
    }))
    await createFragment(dataDir, storyId, makeCharacter({
      id: 'kn-item01',
      type: 'knowledge',
      name: 'Some Lore',
    }))
    execute = createSetCharacterVoiceTool(dataDir, storyId).execute!
  })

  afterEach(async () => {
    await cleanup()
  })

  it('stores the voice verbatim and carries other fields forward', async () => {
    const result = await execute!({ fragmentId: 'ch-maya01', voice: 'Clipped sentences.  ' }, { toolCallId: 'a', messages: [] })

    expect(result).toMatchObject({ ok: true, fragmentId: 'ch-maya01', voiceSet: true })
    const stored = await getFragment(dataDir, storyId, 'ch-maya01')
    // Verbatim — trailing spaces survive.
    expect(stored?.meta.voice).toBe('Clipped sentences.  ')
    expect(stored?.content).toBe('A detective with a dry wit.')
    expect(stored?.name).toBe('Maya')
  })

  it('preserves unrelated meta keys when setting voice', async () => {
    await createFragment(dataDir, storyId, makeCharacter({
      id: 'ch-meta01',
      name: 'Meta',
      meta: { custom: 'keep me' },
    }))

    await execute!({ fragmentId: 'ch-meta01', voice: 'Booming.' }, { toolCallId: 'b', messages: [] })

    const stored = await getFragment(dataDir, storyId, 'ch-meta01')
    expect(stored?.meta.custom).toBe('keep me')
    expect(stored?.meta.voice).toBe('Booming.')
  })

  it('removes the voice entirely on empty string', async () => {
    await createFragment(dataDir, storyId, makeCharacter({
      id: 'ch-clear01',
      name: 'Clearable',
      meta: { voice: 'Old voice' },
    }))

    const result = await execute!({ fragmentId: 'ch-clear01', voice: '' }, { toolCallId: 'c', messages: [] })

    expect(result).toMatchObject({ ok: true, voiceSet: false })
    const stored = await getFragment(dataDir, storyId, 'ch-clear01')
    expect('voice' in (stored?.meta ?? {})).toBe(false)
  })

  it('refuses non-character fragments', async () => {
    const result = await execute!({ fragmentId: 'kn-item01', voice: 'nope' }, { toolCallId: 'd', messages: [] })
    expect(result).toMatchObject({ error: expect.stringContaining('only character fragments') })
  })

  it('refuses locked characters', async () => {
    const result = await execute!({ fragmentId: 'ch-lock01', voice: 'nope' }, { toolCallId: 'e', messages: [] })
    expect(result).toMatchObject({ error: expect.stringContaining('locked') })
  })

  it('reports missing fragments', async () => {
    const result = await execute!({ fragmentId: 'ch-nonexistent', voice: 'x' }, { toolCallId: 'f', messages: [] })
    expect(result).toMatchObject({ error: expect.stringContaining('not found') })
  })
})
