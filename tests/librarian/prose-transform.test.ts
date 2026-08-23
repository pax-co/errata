import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTempDir, seedTestProvider, makeTestSettings } from '../setup'
import {
  createStory,
  createFragment,
} from '@/server/fragments/storage'
import type { StoryMeta, Fragment } from '@/server/fragments/schema'

// Mock the AI SDK ToolLoopAgent
const mockAgentCtor = vi.fn()
const mockAgentStream = vi.fn()

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    ToolLoopAgent: class MockToolLoopAgent {
      constructor(config: unknown) {
        mockAgentCtor(config)
        const instance = { stream: mockAgentStream }
        return instance as unknown as MockToolLoopAgent
      }
    },
  }
})

import { ensureCoreAgentsRegistered } from '@/server/agents'
import { saveAgentBlockConfig } from '@/server/agents/agent-block-storage'
import { transformProseSelection } from '@/server/librarian/prose-transform'

function makeStory(overrides: Partial<StoryMeta> = {}): StoryMeta {
  const now = new Date().toISOString()
  return {
    id: 'story-test',
    name: 'Test Story',
    description: 'A test story',
    coverImage: null,
    summary: 'A hero enters a forest.',
    createdAt: now,
    updatedAt: now,
    settings: makeTestSettings(),
    ...overrides,
  }
}

function makeFragment(overrides: Partial<Fragment>): Fragment {
  const now = new Date().toISOString()
  return {
    id: 'pr-0001',
    type: 'prose',
    name: 'Scene',
    description: 'A scene',
    content: 'The guard moved quickly down the hall.',
    tags: [],
    refs: [],
    sticky: false,
    placement: 'user' as const,
    createdAt: now,
    updatedAt: now,
    order: 0,
    meta: {},
    archived: false,
    ...overrides,
  }
}

function mockStreamResponse(text: string) {
  return {
    fullStream: (async function* () {
      yield { type: 'text-delta', text }
      yield { type: 'finish', finishReason: 'stop' }
    })(),
    totalUsage: Promise.resolve(undefined),
  }
}

async function drainEventStream(result: { eventStream: ReadableStream<string> }): Promise<void> {
  const reader = result.eventStream.getReader()
  while (!(await reader.read()).done) {
    // drain
  }
}

describe('prose transform sticky context', () => {
  let dataDir: string
  let cleanup: () => Promise<void>
  const storyId = 'story-test'

  beforeEach(async () => {
    const tmp = await createTempDir()
    dataDir = tmp.path
    cleanup = tmp.cleanup
    await seedTestProvider(dataDir)
    ensureCoreAgentsRegistered()
    mockAgentCtor.mockClear()
    mockAgentStream.mockClear()

    await createStory(dataDir, makeStory())
    await createFragment(dataDir, storyId, makeFragment({}))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'kn-school1',
      type: 'knowledge',
      name: 'School',
      description: 'The academy',
      content: 'The academy sits on a cliff above the sea.',
      sticky: true,
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'gl-tone01',
      type: 'guideline',
      name: 'Tone',
      description: 'Story tone',
      content: 'Keep the prose gothic and moody.',
      sticky: true,
    }))
    await createFragment(dataDir, storyId, makeFragment({
      id: 'kn-other1',
      type: 'knowledge',
      name: 'Distant Lore',
      description: 'Unpinned lore',
      content: 'A forgotten kingdom lies beyond the mountains.',
      sticky: false,
    }))
  })

  afterEach(async () => {
    await cleanup()
  })

  async function runTransform(): Promise<string> {
    mockAgentStream.mockResolvedValue(mockStreamResponse('The sentinel darted down the corridor.'))
    const result = await transformProseSelection(dataDir, storyId, {
      fragmentId: 'pr-0001',
      selectedText: 'The guard moved quickly down the hall.',
      operation: 'expand',
    })
    await drainEventStream(result)

    expect(mockAgentStream).toHaveBeenCalled()
    const { messages } = mockAgentStream.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userMessage = messages.find(m => m.role === 'user')
    expect(userMessage).toBeDefined()
    return userMessage!.content
  }

  it('includes sticky knowledge and guidelines in the compiled context', async () => {
    const userContent = await runTransform()
    expect(userContent).toContain('The academy sits on a cliff above the sea.')
    expect(userContent).toContain('Keep the prose gothic and moody.')
  })

  it('places sticky context before the selection', async () => {
    const userContent = await runTransform()
    const stickyIndex = userContent.indexOf('The academy sits on a cliff above the sea.')
    const selectionIndex = userContent.indexOf('Selected span to transform:')
    expect(stickyIndex).toBeGreaterThanOrEqual(0)
    expect(selectionIndex).toBeGreaterThan(stickyIndex)
  })

  it('does not include non-sticky fragments', async () => {
    const userContent = await runTransform()
    expect(userContent).not.toContain('A forgotten kingdom lies beyond the mountains.')
  })

  it('respects a disabled sticky-fragments block in agent block config', async () => {
    await saveAgentBlockConfig(dataDir, storyId, 'librarian.prose-transform', {
      customBlocks: [],
      overrides: {
        'sticky-fragments': { enabled: false },
      },
      blockOrder: [],
      disabledTools: [],
    })

    const userContent = await runTransform()
    expect(userContent).not.toContain('The academy sits on a cliff above the sea.')
    expect(userContent).not.toContain('Keep the prose gothic and moody.')
    expect(userContent).toContain('Selected span to transform:')
  })

  describe('pov voice', () => {
    interface StreamCall {
      messages: Array<{ role: string; content: string }>
    }

    async function runTransformWithPov(povCharacterId?: string): Promise<string> {
      mockAgentStream.mockResolvedValue(mockStreamResponse('The sentinel darted down the corridor.'))
      const result = await transformProseSelection(dataDir, storyId, {
        fragmentId: 'pr-0001',
        selectedText: 'The guard moved quickly down the hall.',
        operation: 'expand',
        povCharacterId,
      })
      await drainEventStream(result)

      const call = mockAgentStream.mock.calls[0][0] as StreamCall
      const userMessage = call.messages.find(m => m.role === 'user')
      expect(userMessage).toBeDefined()
      return userMessage!.content
    }

    it('resolves povCharacterId into the pov-voice block', async () => {
      await createFragment(dataDir, storyId, makeFragment({
        id: 'ch-rider1',
        type: 'character',
        name: 'Rider',
        description: 'A courier',
        content: 'A fast-talking courier.',
        meta: { voice: 'Clipped, sardonic.' },
      }))

      const userContent = await runTransformWithPov('ch-rider1')
      expect(userContent).toContain("Write from Rider's point of view")
      expect(userContent).toContain('Clipped, sardonic.')
    })

    it('falls back to natural-speech guidance when the character has no voice notes', async () => {
      await createFragment(dataDir, storyId, makeFragment({
        id: 'ch-rider1',
        type: 'character',
        name: 'Rider',
        description: 'A courier',
        content: 'A fast-talking courier.',
      }))

      const userContent = await runTransformWithPov('ch-rider1')
      expect(userContent).toContain("Write from Rider's point of view")
      expect(userContent).toContain('match how Rider naturally speaks elsewhere in the story')
    })

    it('omits the pov-voice block without povCharacterId', async () => {
      const userContent = await runTransformWithPov()
      expect(userContent).not.toContain("point of view, fully using")
    })

    it('ignores a povCharacterId that is not a character fragment', async () => {
      const userContent = await runTransformWithPov('pr-0001')
      expect(userContent).not.toContain("point of view, fully using")
    })
  })
})
