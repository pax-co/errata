import type { Fragment, StoryMeta } from '../fragments/schema'
import type { PovVoice } from '../llm/context-builder'

/**
 * Shared context type that all agent block builders receive.
 * Superset of data — each agent uses the fields it needs.
 */
export interface AgentBlockContext {
  /** Fetch any fragment by ID (async). Available in script blocks as ctx.getFragment(id). */
  getFragment?: (id: string) => Promise<Fragment | null>

  /** Resolved model ID, used for model-aware instruction resolution. */
  modelId?: string

  // Common (from ContextBuildState)
  story: StoryMeta
  proseFragments: Fragment[]
  stickyGuidelines: Fragment[]
  stickyKnowledge: Fragment[]
  stickyCharacters: Fragment[]
  guidelineShortlist: Fragment[]
  knowledgeShortlist: Fragment[]
  characterShortlist: Fragment[]

  // System prompt fragments (tagged pass-to-librarian-system-prompt)
  systemPromptFragments: Fragment[]

  // Story setup
  storySetupFragments?: Fragment[]
  storySetupReferenceFragments?: Fragment[]

  // Librarian analyze
  allCharacters?: Fragment[]
  allKnowledge?: Fragment[]
  newProse?: { id: string; content: string }

  // Librarian refine
  targetFragment?: Fragment
  instructions?: string

  // Prose transform
  operation?: string
  guidance?: string
  selectedText?: string
  sourceContent?: string
  contextBefore?: string
  contextAfter?: string

  // Character chat
  character?: Fragment
  personaDescription?: string

  /** Resolved POV voice for the writer's pov-voice block. Preview builders set a placeholder so the block is visible/configurable in the block editor. */
  povVoice?: PovVoice

  // Plugin tools
  pluginToolDescriptions?: Array<{ name: string; description: string }>
}
