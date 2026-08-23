import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { ensureCoreAgentsRegistered } from '@/server/agents/register-core'
import { createTempDir, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'
import {
  buildContextState,
  createDefaultBlocks,
  getFragmentVoice,
  resolvePovVoicePlaceholders,
  findBlock,
} from '@/server/llm/context-builder'
import { createWriterBriefBlocks } from '@/server/llm/prewriter'
import { clarifyBody } from '@/lib/api/generation'

/** Convenience: build default blocks and resolve POV placeholders like the route does. */
async function buildResolvedBlocks(dataDir: string, storyId: string, input = 'continue', povCharacterId?: string) {
  const state = await buildContextState(dataDir, storyId, input, povCharacterId ? { povCharacterId } : {})
  return {
    state,
    resolved: resolvePovVoicePlaceholders(createDefaultBlocks(state), state.povVoice),
  }
}

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
    ...overrides,
  }
}

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

describe('pov voice', () => {
  let dataDir: string
  let cleanup: () => Promise<void>

  beforeAll(() => {
    ensureCoreAgentsRegistered()
  })

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  describe('getFragmentVoice', () => {
    it('returns trimmed voice from meta', () => {
      expect(getFragmentVoice(makeCharacter({ meta: { voice: '  Clipped sentences.  ' } }))).toBe('Clipped sentences.')
    })

    it('returns undefined for missing, non-string, or blank voice', () => {
      expect(getFragmentVoice(makeCharacter({ meta: {} }))).toBeUndefined()
      expect(getFragmentVoice(makeCharacter({ meta: { voice: 42 } }))).toBeUndefined()
      expect(getFragmentVoice(makeCharacter({ meta: { voice: '   ' } }))).toBeUndefined()
    })
  })

  describe('buildContextState', () => {
    it('resolves povVoice with voice content for the requested character', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeCharacter({
        id: 'ch-maya01',
        name: 'Maya',
        meta: { voice: 'First person, sardonic, short sentences.' },
      }))
      await createFragment(dataDir, story.id, makeCharacter({
        id: 'ch-vexx02',
        name: 'Vexx',
        meta: { voice: 'Booming and theatrical.' },
      }))

      const state = await buildContextState(dataDir, story.id, 'continue', { povCharacterId: 'ch-maya01' })

      expect(state.povVoice).toEqual({
        characterName: 'Maya',
        content: 'First person, sardonic, short sentences.',
      })
    })

    it('resolves povVoice without content when the character has no voice notes', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeCharacter({ id: 'ch-maya01', name: 'Maya', meta: {} }))

      const state = await buildContextState(dataDir, story.id, 'continue', { povCharacterId: 'ch-maya01' })

      expect(state.povVoice).toMatchObject({ characterName: 'Maya' })
      expect(state.povVoice?.content).toBeUndefined()
    })

    it('ignores an unknown POV character id without failing', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'continue', { povCharacterId: 'ch-nonexistent' })

      expect(state.povVoice).toBeUndefined()
    })
  })

  describe('createDefaultBlocks', () => {
    it('emits a pov-voice template block that resolves to the character name and voice', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeCharacter({
        id: 'ch-maya01',
        name: 'Maya',
        meta: { voice: 'First person, sardonic.' },
      }))

      const { resolved } = await buildResolvedBlocks(dataDir, story.id, 'continue', 'ch-maya01')
      const block = findBlock(resolved, 'pov-voice')

      expect(block).toBeDefined()
      expect(block!.role).toBe('user')
      expect(block!.source).toBe('builtin')
      expect(block!.content).toContain("Maya's point of view")
      expect(block!.content).toContain("Maya's unique voice")
      expect(block!.content).toContain('First person, sardonic.')
    })

    it('leaves {{characterName}}/{{voice}} tokens unresolved before resolution runs', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeCharacter({ id: 'ch-maya01', name: 'Maya', meta: { voice: 'x' } }))

      const state = await buildContextState(dataDir, story.id, 'continue', { povCharacterId: 'ch-maya01' })
      const block = findBlock(createDefaultBlocks(state), 'pov-voice')

      expect(block!.content).toContain('{{characterName}}')
      expect(block!.content).toContain('{{voice}}')
    })

    it('orders pov-voice after author-input so it lands last before generation', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeCharacter({ id: 'ch-maya01', name: 'Maya', meta: { voice: 'x' } }))

      const state = await buildContextState(dataDir, story.id, 'continue', { povCharacterId: 'ch-maya01' })
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'pov-voice')!.order).toBeGreaterThan(findBlock(blocks, 'author-input')!.order)
    })

    it('resolves to fallback guidance when no voice notes exist', async () => {
      const story = makeStory()
      await createStory(dataDir, story)
      await createFragment(dataDir, story.id, makeCharacter({ id: 'ch-maya01', name: 'Maya', meta: {} }))

      const { resolved } = await buildResolvedBlocks(dataDir, story.id, 'continue', 'ch-maya01')
      const block = findBlock(resolved, 'pov-voice')

      expect(block).toBeDefined()
      expect(block!.content).toContain("Maya's unique voice: match how Maya naturally speaks elsewhere in the story")
    })

    it('emits no pov-voice block when no POV is set', async () => {
      const story = makeStory()
      await createStory(dataDir, story)

      const state = await buildContextState(dataDir, story.id, 'continue')
      const blocks = createDefaultBlocks(state)

      expect(findBlock(blocks, 'pov-voice')).toBeUndefined()
    })
  })

  describe('request payload (clarifyBody)', () => {
    it('sends povCharacterId on its own and alongside clarifications', () => {
      expect(clarifyBody({ povCharacterId: 'ch-maya01' })).toEqual({ povCharacterId: 'ch-maya01' })
      expect(clarifyBody({ povCharacterId: 'ch-maya01', clarifications: [{ question: 'q', answer: 'a' }], clarifyRound: 1 })).toEqual({
        povCharacterId: 'ch-maya01',
        clarifications: [{ question: 'q', answer: 'a' }],
        clarifyRound: 1,
      })
    })

    it('treats blank POV as narrator — not sent', () => {
      expect(clarifyBody({ povCharacterId: '' })).toEqual({})
    })
  })

  describe('prewriter writer-brief passthrough', () => {
    it('includes the pov-voice template block after the brief and resolves it', () => {
      const blocks = createWriterBriefBlocks(
        [],
        'Scene setup: a rainy rooftop.',
        ['- getFragment(id): Get full content'],
        undefined,
        { characterName: 'Maya', content: 'First person, sardonic.' },
      )
      const resolved = resolvePovVoicePlaceholders(blocks, { characterName: 'Maya', content: 'First person, sardonic.' })
      const resolvedBlock = findBlock(resolved, 'pov-voice')
      expect(findBlock(blocks, 'pov-voice')!.order).toBeGreaterThan(findBlock(blocks, 'writing-brief')!.order)
      expect(resolvedBlock).toBeDefined()
      expect(resolvedBlock!.role).toBe('user')
      expect(resolvedBlock!.content).toContain("Maya's point of view")
      expect(resolvedBlock!.content).toContain('First person, sardonic.')
    })

    it('omits the pov-voice block when no povVoice is passed', () => {
      const blocks = createWriterBriefBlocks([], 'brief', [])
      expect(findBlock(blocks, 'pov-voice')).toBeUndefined()
    })
  })

  describe('resolvePovVoicePlaceholders', () => {
    const povVoice = { characterName: 'Maya', content: 'Sardonic.' }

    function povBlock(content: string): Parameters<typeof resolvePovVoicePlaceholders>[0] {
      return [
        { id: 'instructions', role: 'system', content: 'write well', order: 100, source: 'builtin' },
        { id: 'pov-voice', role: 'user', content, order: 650, source: 'builtin' },
      ]
    }

    it('substitutes tokens at their custom position (override text controls placement)', () => {
      const custom = `You are {{characterName}}.\nRULES:\n{{voice}}\nEnd with a hook.`
      const block = findBlock(resolvePovVoicePlaceholders(povBlock(custom), povVoice), 'pov-voice')!

      expect(block.content).toBe('You are Maya.\nRULES:\nSardonic.\nEnd with a hook.')
    })

    it('drops the voice when an override omits the {{voice}} token', () => {
      const block = findBlock(resolvePovVoicePlaceholders(povBlock('Write as {{characterName}} only.'), povVoice), 'pov-voice')!

      expect(block.content).toBe('Write as Maya only.')
      expect(block.content).not.toContain('Sardonic.')
    })

    it('falls back to guidance text when {{voice}} is present but no voice notes exist', () => {
      const nameOnly = { ...povVoice, content: undefined }
      const block = findBlock(resolvePovVoicePlaceholders(povBlock('{{characterName}}\n{{voice}}'), nameOnly), 'pov-voice')!

      expect(block.content).toContain('Maya\nmatch how Maya naturally speaks elsewhere in the story')
    })

    it('leaves other blocks untouched', () => {
      const blocks = resolvePovVoicePlaceholders(povBlock('{{characterName}}: {{voice}}'), povVoice)
      expect(findBlock(blocks, 'instructions')!.content).toBe('write well')
    })
  })
})
