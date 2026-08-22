import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTempDir, makeTestSettings } from '../setup'
import { createStory } from '@/server/fragments/storage'
import type { StoryMeta } from '@/server/fragments/schema'
import {
  createConversation,
  listConversations,
  saveConversationHistory,
} from '@/server/librarian/storage'

function makeStory(): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-conv-test',
    name: 'Conv Test Story',
    description: 'A story for conversation storage tests',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

describe('librarian conversation storage concurrency', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  let storyId: string

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    const story = makeStory()
    await createStory(dataDir, story)
    storyId = story.id
  })

  afterEach(async () => {
    await cleanup()
  })

  it('keeps every record when many conversations are created concurrently', async () => {
    const created = await Promise.all(
      Array.from({ length: 25 }, (_, i) => createConversation(dataDir, storyId, `conv-${i}`)),
    )

    const listed = await listConversations(dataDir, storyId)
    expect(listed).toHaveLength(created.length)
    for (const conv of created) {
      expect(listed.find(c => c.id === conv.id)).toEqual(conv)
    }
  })

  it('a background history save does not erase conversations created meanwhile', async () => {
    const first = await createConversation(dataDir, storyId, 'New chat')
    await saveConversationHistory(dataDir, storyId, first.id, [
      { role: 'user', content: 'hello from the first chat' },
    ])

    // The refine race: an earlier chat's completion writes its history/index
    // update while new conversations are being created.
    await Promise.all([
      saveConversationHistory(dataDir, storyId, first.id, [
        { role: 'user', content: '@pr-late late completion' },
      ]),
      ...Array.from({ length: 10 }, (_, i) => createConversation(dataDir, storyId, `refine-${i}`)),
    ])

    const listed = await listConversations(dataDir, storyId)
    expect(listed).toHaveLength(11)

    const firstAfter = listed.find(c => c.id === first.id)
    expect(firstAfter).toBeDefined()
    // Auto-title ran on the first user message...
    expect(firstAfter!.title).toBe('hello from the first chat')
    // ...and the later save did not overwrite it or lose siblings.
    for (let i = 0; i < 10; i++) {
      expect(listed.find(c => c.title === `refine-${i}`)).toBeDefined()
    }
  })
})
