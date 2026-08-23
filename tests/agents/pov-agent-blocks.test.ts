import { describe, it, expect, beforeAll } from 'vitest'
import { makeTestSettings } from '../setup'
import { ensureCoreAgentsRegistered } from '@/server/agents'
import { agentBlockRegistry } from '@/server/agents/agent-block-registry'
import type { AgentBlockContext } from '@/server/agents/agent-block-context'
import type { Fragment, StoryMeta } from '@/server/fragments/schema'

const now = new Date().toISOString()

function makeStory(): StoryMeta {
  return {
    id: 'story-pov-test',
    name: 'POV Test Story',
    description: 'A story for pov block builder tests',
    coverImage: null,
    summary: '',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
  }
}

function makeFragment(overrides: Partial<Fragment> = {}): Fragment {
  return {
    id: 'ch-test01',
    type: 'character',
    name: 'Hero',
    description: 'The main character',
    content: 'A brave hero.',
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

function makeBaseContext(overrides: Partial<AgentBlockContext> = {}): AgentBlockContext {
  return {
    story: makeStory(),
    proseFragments: [],
    stickyGuidelines: [],
    stickyKnowledge: [],
    stickyCharacters: [],
    guidelineShortlist: [],
    knowledgeShortlist: [],
    characterShortlist: [],
    systemPromptFragments: [],
    ...overrides,
  }
}

describe('POV voice in agent blocks', () => {
  beforeAll(() => {
    ensureCoreAgentsRegistered()
  })

  describe('librarian.chat', () => {
    it('emits the pov-voice template only when povVoice is set', () => {
      const def = agentBlockRegistry.get('librarian.chat')!

      const withPov = def.createDefaultBlocks(makeBaseContext({
        povVoice: { characterName: 'Hero', content: 'Clipped, sardonic.' },
      }))
      const block = withPov.find(b => b.id === 'pov-voice')
      expect(block).toBeDefined()
      expect(block!.content).toContain('{{characterName}}')
      expect(block!.content).toContain('{{voice}}')

      const withoutPov = def.createDefaultBlocks(makeBaseContext())
      expect(withoutPov.find(b => b.id === 'pov-voice')).toBeUndefined()
    })
  })

  describe('librarian.prose-transform', () => {
    it('emits the pov-voice template only when povVoice is set', () => {
      const def = agentBlockRegistry.get('librarian.prose-transform')!

      const withPov = def.createDefaultBlocks(makeBaseContext({
        operation: 'rewrite',
        selectedText: 'The hero walked.',
        povVoice: { characterName: 'Hero', content: 'Clipped, sardonic.' },
      }))
      const block = withPov.find(b => b.id === 'pov-voice')
      expect(block).toBeDefined()
      expect(block!.content).toContain('{{characterName}}')
      expect(block!.content).toContain('{{voice}}')
      const maxOtherOrder = Math.max(...withPov.filter(b => b.id !== 'pov-voice').map(b => b.order))
      expect(block!.order).toBeGreaterThan(maxOtherOrder)

      const withoutPov = def.createDefaultBlocks(makeBaseContext({
        operation: 'rewrite',
        selectedText: 'The hero walked.',
      }))
      expect(withoutPov.find(b => b.id === 'pov-voice')).toBeUndefined()
    })
  })

  describe('librarian.refine target fragment', () => {
    it('includes character POV voice notes in the target block', () => {
      const def = agentBlockRegistry.get('librarian.refine')!
      const blocks = def.createDefaultBlocks(makeBaseContext({
        targetFragment: makeFragment({ id: 'ch-hero01', name: 'Hero', meta: { voice: 'Clipped, sardonic.' } }),
        instructions: 'Update the backstory',
      }))
      const target = blocks.find(b => b.id === 'target')!
      expect(target.content).toContain('POV voice notes')
      expect(target.content).toContain('Clipped, sardonic.')
    })

    it('omits voice notes for characters without them and for non-characters', () => {
      const def = agentBlockRegistry.get('librarian.refine')!

      const noVoice = def.createDefaultBlocks(makeBaseContext({
        targetFragment: makeFragment({ id: 'ch-hero01', name: 'Hero', meta: {} }),
      }))
      expect(noVoice.find(b => b.id === 'target')!.content).not.toContain('POV voice notes')

      const knowledge = def.createDefaultBlocks(makeBaseContext({
        targetFragment: makeFragment({ id: 'kn-lore01', type: 'knowledge', name: 'Lore', meta: { voice: 'irrelevant here' } }),
      }))
      expect(knowledge.find(b => b.id === 'target')!.content).not.toContain('POV voice notes')
    })
  })
})
