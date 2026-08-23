import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Fragment } from '@/lib/api'
import { Textarea } from '@/components/ui/textarea'

interface VoiceFieldProps {
  storyId: string
  fragment: Fragment | null
  disabled?: boolean
}

const SAVE_DEBOUNCE_MS = 800

function readVoice(fragment: Fragment | null): string {
  const raw = fragment?.meta?.voice
  return typeof raw === 'string' ? raw : ''
}

/**
 * Self-contained editor for a character fragment's POV voice notes (meta.voice).
 *
 * Keeps a local draft overlay on top of the saved value so external meta
 * updates flow through while untouched. Saves are debounced from the change
 * handler and flushed on blur (closing the editor always blurs first), so no
 * effects are needed and the fragment editor's auto-save pipeline stays
 * untouched.
 */
export function VoiceField({ storyId, fragment, disabled }: VoiceFieldProps) {
  const queryClient = useQueryClient()
  // Draft overlay: null = show the saved voice from props.
  const [draft, setDraft] = useState<string | null>(null)
  const [prevFragmentId, setPrevFragmentId] = useState(fragment?.id)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Different fragment loaded: drop the pending draft (render-time reset).
  if (fragment?.id !== prevFragmentId) {
    setPrevFragmentId(fragment?.id)
    setDraft(null)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const value = draft ?? readVoice(fragment)

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!fragment) throw new Error('No fragment')
      // Store verbatim — trimming here strips trailing spaces mid-typing and
      // the field snaps back when the trimmed value round-trips. Trim only
      // decides presence.
      const meta: Record<string, unknown> = { ...fragment.meta }
      if (value.trim()) meta.voice = value
      else delete meta.voice
      return api.fragments.update(storyId, fragment.id, {
        name: fragment.name,
        description: fragment.description,
        content: fragment.content,
        meta,
      })
    },
    onSuccess: () => {
      if (fragment) queryClient.invalidateQueries({ queryKey: ['fragment', storyId, fragment.id] })
    },
  })

  const commitRef = useRef<() => void>(() => {})

  // Flushes any pending timer; saves when the draft differs from the saved voice.
  function commitNow() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (draft !== null && fragment && draft !== readVoice(fragment)) {
      saveMutation.mutate()
    }
  }
  // Latest-render closure for the debounce callback (no stale state).
  commitRef.current = commitNow

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider">
        Voice <span className="normal-case tracking-normal text-muted-foreground">(used when this character is POV)</span>
      </label>
      <Textarea
        value={value}
        onChange={(e) => {
          setDraft(e.target.value)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => commitRef.current(), SAVE_DEBOUNCE_MS)
        }}
        onBlur={() => commitRef.current()}
        disabled={disabled}
        placeholder="How they speak and see the world; diction, cadence, verbal tics, inner monologue style..."
        className="bg-transparent min-h-[64px] resize-y text-sm"
      />
    </div>
  )
}
