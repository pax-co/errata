import { fetchEventStream } from './client'
import type { GenerationLogSummary, GenerationLog, SuggestionDirection, Clarification } from './types'

/** Optional clarify-before-generate answers carried into a (re)generation request. */
export interface ClarifyOpts {
  clarifications?: Clarification[]
  clarifyRound?: number
}

/** Internal request shape after withPov merges in the picker value. */
type RequestOpts = ClarifyOpts & { povCharacterId?: string }

const POV_STORAGE_PREFIX = 'errata:pov-character'

/** Story's selected POV character for generation requests; undefined = narrator. */
export function readPovCharacterId(storyId: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return localStorage.getItem(`${POV_STORAGE_PREFIX}:${storyId}`) || undefined
  } catch {
    return undefined
  }
}

/** Persists the story's POV selection; undefined/empty = narrator. */
export function writePovCharacterId(storyId: string, characterId: string | undefined): void {
  try {
    if (characterId) localStorage.setItem(`${POV_STORAGE_PREFIX}:${storyId}`, characterId)
    else localStorage.removeItem(`${POV_STORAGE_PREFIX}:${storyId}`)
  } catch {
    // localStorage unavailable — selection just won't persist
  }
}

/**
 * Every generation call follows the picker: the current POV selection is
 * merged over caller opts here so components don't have to thread it.
 */
function withPov(storyId: string, opts?: ClarifyOpts): RequestOpts {
  return { ...opts, povCharacterId: readPovCharacterId(storyId) }
}

export function clarifyBody(opts?: RequestOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (opts?.povCharacterId) body.povCharacterId = opts.povCharacterId
  const clarifications = opts?.clarifications ?? []
  const round = opts?.clarifyRound ?? 0
  // Send the round even with no clarifications so "write anyway" (a high
  // force-proceed round) actually withholds the ask tool server-side. Without
  // this, skipping on the first round would just re-ask.
  if (!clarifications.length && round <= 0) return body
  body.clarifications = clarifications
  body.clarifyRound = round
  return body
}

export const generation = {
  /** Stream prose generation (returns ReadableStream of ChatEvent) */
  stream: (storyId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: false, ...clarifyBody(withPov(storyId, opts)) }, signal),
  /** Generate and save as a new prose fragment */
  generateAndSave: (storyId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, ...clarifyBody(withPov(storyId, opts)) }, signal),
  /** Regenerate an existing fragment with a new prompt */
  regenerate: (storyId: string, fragmentId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'regenerate', fragmentId, ...clarifyBody(withPov(storyId, opts)) }, signal),
  /** Refine an existing fragment with instructions */
  refine: (storyId: string, fragmentId: string, input: string, signal?: AbortSignal, opts?: ClarifyOpts) =>
    fetchEventStream(`/stories/${storyId}/generate`, { input, saveResult: true, mode: 'refine', fragmentId, ...clarifyBody(withPov(storyId, opts)) }, signal),
  /** Get AI-generated story direction suggestions */
  suggestDirections: (storyId: string, count?: number) =>
    apiFetch<{ suggestions: SuggestionDirection[] }>(
      `/stories/${storyId}/suggest-directions`,
      { method: 'POST', body: JSON.stringify({ count }) },
    ),
  /** List generation log summaries (newest first) */
  listLogs: (storyId: string) =>
    apiFetch<GenerationLogSummary[]>(`/stories/${storyId}/generation-logs`),
  /** Get a full generation log by ID */
  getLog: (storyId: string, logId: string) =>
    apiFetch<GenerationLog>(`/stories/${storyId}/generation-logs/${logId}`),
}

// Import apiFetch for the non-streaming methods
import { apiFetch } from './client'
