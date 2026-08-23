import { tool } from 'ai'
import { z } from 'zod/v4'
import { getFragment, updateFragment } from '../fragments/storage'
import { isFragmentLocked } from '../fragments/protection'
import type { Fragment } from '../fragments/schema'

/**
 * Chat-only tool for a character's POV voice notes (meta.voice). Automatic
 * flows (analysis, optimize-character) never receive it, so voice changes
 * only when the author explicitly asks.
 */
export function createSetCharacterVoiceTool(dataDir: string, storyId: string) {
  return tool({
    description:
      'Set or clear the POV voice notes of a character fragment. Only use this when the author explicitly asks to define or change how a character speaks or narrates — never as part of routine edits or optimizations.',
    inputSchema: z.object({
      fragmentId: z.string().describe('The character fragment ID (e.g. ch-bakumo)'),
      voice: z
        .string()
        .describe(
          'The voice notes text — how they speak and narrate (diction, cadence, verbal tics, inner monologue style). Pass an empty string to remove the voice.',
        ),
    }),
    execute: async ({ fragmentId, voice }: { fragmentId: string; voice: string }) => {
      const existing = await getFragment(dataDir, storyId, fragmentId)
      if (!existing) return { error: `Fragment not found: ${fragmentId}` }
      if (existing.type !== 'character') {
        return { error: `Fragment ${fragmentId} is type "${existing.type}"; only character fragments have a voice` }
      }
      if (isFragmentLocked(existing)) return { error: 'Fragment is locked and cannot be modified by AI tools.' }
      // Verbatim storage (trim only decides presence); carries all other fields forward.
      const meta: Record<string, unknown> = { ...existing.meta }
      if (voice.trim()) meta.voice = voice
      else delete meta.voice
      const updated: Fragment = { ...existing, meta, updatedAt: new Date().toISOString() }
      await updateFragment(dataDir, storyId, updated)
      return { ok: true, fragmentId, voiceSet: Boolean(voice.trim()) }
    },
  })
}
