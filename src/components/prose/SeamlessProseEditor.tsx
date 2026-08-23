import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { AlertTriangle, Check, Loader2, Minimize2, PenLine, Sparkles, Undo2, Wand2 } from 'lucide-react'
import { api, type Fragment } from '@/lib/api'
import {
  findPlainTextPos,
  findPlainTextRange,
  plainTextToDoc,
  scanInlineStyling,
  type InlineStyleKind,
} from '@/lib/prose-editor-content'
import { FloatingElement } from '@/components/tiptap/FloatingElement'
import { Button } from '@/components/ui/button'
import { useWritingTransforms, useTransformContext, TRANSFORM_CONTEXT_CHARS } from '@/lib/theme'

type SeamlessSaveState = 'idle' | 'saving' | 'saved' | 'error'
type SelectionTransformMode = 'rewrite' | 'expand' | 'compress' | 'custom'

const PRIMARY_TRANSFORMS = [
  { mode: 'rewrite', icon: Sparkles, label: 'Rewrite' },
  { mode: 'expand', icon: Wand2, label: 'Expand' },
  { mode: 'compress', icon: Minimize2, label: 'Compress' },
] as const

// One inline edit session at a time, app-wide: claiming ends the current
// holder, whose teardown persist commits its pending text.
let activeSessionEnd: (() => void) | null = null

function claimSession(end: () => void): void {
  activeSessionEnd?.()
  activeSessionEnd = end
}

function releaseSession(end: () => void): void {
  if (activeSessionEnd === end) activeSessionEnd = null
}

export interface SeamlessEditSession {
  fragment: Fragment
  selection: string | null
  offset: number | null
}

// The fragment is frozen at claim time so a variation switch can't redirect
// the session's save; a fragment.id mismatch ends and saves the captured one.
export function useSeamlessSession(fragment: Fragment): {
  session: SeamlessEditSession | null
  editing: boolean
  start: (anchor: number | null) => void
  end: () => void
} {
  const [session, setSession] = useState<SeamlessEditSession | null>(null)

  const end = useCallback(() => {
    releaseSession(end)
    setSession(null)
  }, [])

  const start = useCallback((anchor: number | null) => {
    claimSession(end)
    setSession({
      fragment,
      selection: window.getSelection()?.toString() || null,
      offset: anchor,
    })
  }, [fragment])

  useEffect(() => {
    if (session && session.fragment.id !== fragment.id) end()
  }, [fragment.id, session, end])

  return { session, editing: session !== null, start, end }
}

/**
 * Read-view parity, wired via editorProps.decorations below (a plain
 * EditorView prop; no plugin): dialogue colored + italic via .prose-dialogue
 * (styles.css theme token), emphasis italic/semibold like StreamMarkdown's
 * prose variant, delimiter chars dimmed. Display-only, the model stays plain
 * text, so saves are byte-identical.
 */
const STYLE_CLASS: Record<InlineStyleKind, string> = {
  dialogue: 'prose-dialogue italic',
  em: 'italic',
  strong: 'font-semibold',
  'em-strong': 'italic font-semibold',
}

function buildSyntaxDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const { styled, markers } = scanInlineStyling(node.text)
    for (const range of styled) {
      decorations.push(Decoration.inline(pos + range.from, pos + range.to, { class: STYLE_CLASS[range.kind] }))
    }
    for (const range of markers) {
      decorations.push(Decoration.inline(pos + range.from, pos + range.to, { class: 'opacity-40' }))
    }
    return true
  })
  return DecorationSet.create(doc, decorations)
}

function readingTime(words: number): string {
  const minutes = Math.ceil(words / 238)
  return minutes < 1 ? '<1m' : `${minutes}m`
}

interface EditorStats {
  chars: number
  words: number
  tokens: number
  paragraphs: number
}

function computeEditorStats(text: string): EditorStats {
  const trimmed = text.trim()
  const chars = text.length
  return {
    chars,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    tokens: Math.ceil(chars / 4),
    paragraphs: trimmed ? trimmed.split(/\n\n+/).length : 0,
  }
}

interface SeamlessProseEditorProps {
  storyId: string
  fragment: Fragment
  /** Text to pre-select (carried over from the reading view's selection). */
  initialSelection?: string | null
  /** Caret plain-text offset used when there is no selection. */
  initialOffset?: number | null
  onSaved?: () => void
  onExit: () => void
}

/**
 * Inline passage editor rendered in place of StreamMarkdown inside a prose
 * block. Same container geometry and typography (`prose-content`), so the
 * text does not move when editing starts.
 */
export function SeamlessProseEditor({
  storyId,
  fragment,
  initialSelection,
  initialOffset,
  onSaved,
  onExit,
}: SeamlessProseEditorProps) {
  const queryClient = useQueryClient()
  const [saveState, setSaveState] = useState<SeamlessSaveState>('idle')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const cancelledRef = useRef(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const isTransformingRef = useRef(false)
  const [selectionTransformMode, setSelectionTransformMode] = useState<SelectionTransformMode | null>(null)
  const [selectionTransformReasoning, setSelectionTransformReasoning] = useState('')
  const [customTransformLabel, setCustomTransformLabel] = useState<string | null>(null)
  const [showTransformUndo, setShowTransformUndo] = useState(false)
  const transformUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [writingTransforms] = useWritingTransforms()
  const [transformContext] = useTransformContext()
  const enabledTransforms = writingTransforms.filter(t => t.enabled)
  // Local source of truth for the last persisted text — query refreshes must
  // not clobber an active editing session, and unchanged saves are no-ops.
  const baselineRef = useRef(fragment.content)
  const latestRef = useRef({ storyId, fragment, queryClient, onSaved })
  latestRef.current = { storyId, fragment, queryClient, onSaved }

  // Skip rescans when only the selection changed (keyed on doc identity).
  const styleCacheRef = useRef<{ doc: ProseMirrorNode | null; set: DecorationSet | null }>({
    doc: null,
    set: null,
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
      }),
    ],
    content: plainTextToDoc(fragment.content),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // The trailing ! matters: the unlayered global `.ProseMirror p + p`
        // margin rule outranks layered utilities, so matching StreamMarkdown's
        // prose rhythm (mb-[0.85em]) needs the important modifier here.
        class:
          'prose-content font-prose max-w-none min-h-[4rem] focus:outline-none caret-primary [&_p+p]:mt-[0.85em]!',
      },
      // Swallow Mod+Enter here (direct props outrank plugin keymaps) so HardBreak's binding can't newline before save-and-exit.
      handleKeyDown(_view, event) {
        return (event.ctrlKey || event.metaKey) && event.key === 'Enter'
      },
      decorations(state) {
        const cache = styleCacheRef.current
        if (!cache.set || cache.doc !== state.doc) {
          cache.doc = state.doc
          cache.set = buildSyntaxDecorations(state.doc)
        }
        return cache.set
      },
    },
  })

  const editorRef = useRef<Editor | null>(null)
  editorRef.current = editor

  useEffect(() => {
    if (!editor) return
    const range = initialSelection ? findPlainTextRange(editor.state.doc, initialSelection, initialOffset) : null
    const pos = range ?? (initialOffset != null ? findPlainTextPos(editor.state.doc, initialOffset) : null)
    if (pos !== null) editor.commands.setTextSelection(pos)
    editor.commands.focus(pos !== null ? undefined : 'end')
  }, [editor, initialSelection, initialOffset])

  // Track selection reactively so the floating transform toolbar can show/hide
  useEffect(() => {
    if (!editor) return
    const update = () => setHasSelection(!editor.state.selection.empty)
    update()
    editor.on('transaction', update)
    return () => {
      editor.off('transaction', update)
    }
  }, [editor])

  // Live document stats for the footer, recomputed on update transactions only
  const [editorStats, setEditorStats] = useState<EditorStats>({ chars: 0, words: 0, tokens: 0, paragraphs: 0 })
  useEffect(() => {
    if (!editor) return
    const update = () => setEditorStats(computeEditorStats(editor.getText({ blockSeparator: '\n\n' })))
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  const persist = useCallback(
    async (text: string): Promise<boolean> => {
      const ctx = latestRef.current
      try {
        await api.fragments.update(ctx.storyId, ctx.fragment.id, {
          name: ctx.fragment.name,
          description: ctx.fragment.description ?? '',
          content: text,
        })
        baselineRef.current = text
        setSaveState('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000)
        ctx.queryClient.invalidateQueries({ queryKey: ['fragments', ctx.storyId] })
        ctx.onSaved?.()
        return true
      } catch (err) {
        console.error(`[seamless-edit] persist failed for fragment ${ctx.fragment.id}`, err)
        setSaveState('error')
        return false
      }
    },
    [],
  )

  const save = useCallback(async (): Promise<boolean> => {
    if (!editor || savingRef.current) return false
    const next = editor.getText({ blockSeparator: '\n\n' })
    if (next === baselineRef.current) return true
    savingRef.current = true
    setSaveState('saving')
    try {
      return await persist(next)
    } finally {
      savingRef.current = false
    }
  }, [editor, persist])

  const saveAndExit = useCallback(async () => {
    if (await save()) onExit()
  }, [save, onExit])

  // LLM transform of the current selection (rewrite / expand / compress /
  // custom writing transforms), streaming its reasoning into the toolbar.
  const applySelectionTransform = async (mode: SelectionTransformMode, instruction?: string, label?: string) => {
    if (!editor || isTransformingRef.current) return
    const { from, to, empty } = editor.state.selection
    if (empty || to <= from) return

    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    if (!selectedText.trim()) return

    isTransformingRef.current = true
    setIsTransforming(true)
    setSelectionTransformMode(mode)
    setSelectionTransformReasoning('')
    setCustomTransformLabel(label ?? null)
    setShowTransformUndo(false)

    // Typing stays live during the stream; map the captured range through
    // each transaction so the replacement lands where the selection now is.
    let target = { from, to }
    const trackDocEdits = ({ transaction }: { transaction: Transaction }) => {
      target = {
        from: transaction.mapping.map(target.from),
        to: transaction.mapping.map(target.to),
      }
    }
    editor.on('transaction', trackDocEdits)

    try {
      const radius = TRANSFORM_CONTEXT_CHARS[transformContext]
      const contextBefore = editor.state.doc.textBetween(Math.max(0, from - radius), from, '\n')
      const contextAfter = editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + radius), '\n')

      const stream = await api.librarian.transformProseSelection(
        storyId,
        fragment.id,
        mode,
        selectedText,
        {
          sourceContent: editor.getText({ blockSeparator: '\n\n' }),
          contextBefore,
          contextAfter,
          instruction,
        },
      )

      const reader = stream.getReader()
      let transformed = ''
      let reasoning = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.type === 'text') transformed += value.text
        if (value.type === 'reasoning') {
          reasoning += value.text
          setSelectionTransformReasoning(reasoning)
        }
      }

      const compact = transformed.trim()
      if (!compact) return

      const leadingWhitespace = selectedText.match(/^\s*/)?.[0] ?? ''
      const trailingWhitespace = selectedText.match(/\s*$/)?.[0] ?? ''
      const replacement = `${leadingWhitespace}${compact}${trailingWhitespace}`

      editor.chain().focus().insertContentAt(target, replacement).setTextSelection({ from: target.from, to: target.from + replacement.length }).run()
      setSaveState('idle')

      setShowTransformUndo(true)
      if (transformUndoTimerRef.current) clearTimeout(transformUndoTimerRef.current)
      transformUndoTimerRef.current = setTimeout(() => setShowTransformUndo(false), 6000)
    } catch (err) {
      console.error(`[seamless-edit] transform failed for fragment ${fragment.id}`, err)
    } finally {
      editor.off('transaction', trackDocEdits)
      isTransformingRef.current = false
      setIsTransforming(false)
      setSelectionTransformMode(null)
      setCustomTransformLabel(null)
    }
  }

  // Commit pending edits if torn down mid-typing (virtualized row scrolling
  // out of the render window), since blur-save cannot be relied upon there.
  // An intentional Escape discard must not be resurrected by this.
  useEffect(() => {
    return () => {
      const ed = editorRef.current
      if (!ed || cancelledRef.current || savingRef.current) return
      const next = ed.getText({ blockSeparator: '\n\n' })
      if (next === baselineRef.current) return
      void persist(next)
    }
  }, [persist])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!isTransformingRef.current) void saveAndExit()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!isTransformingRef.current) void save()
      } else if (e.key === 'Escape') {
        if (isTransformingRef.current) return
        e.preventDefault()
        cancelledRef.current = true
        onExit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save, saveAndExit, onExit])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (transformUndoTimerRef.current) clearTimeout(transformUndoTimerRef.current)
    }
  }, [])

  return (
    <div
      className="relative"
      data-component-id={`prose-${fragment.id}-inline-editor`}
      onBlur={(e) => {
        if (isTransformingRef.current) return
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        void saveAndExit()
      }}
    >
      <div
        className="pointer-events-none absolute -top-6 right-4 z-10 flex items-center gap-1.5 rounded-full border border-primary/25 bg-popover/95 py-0.5 pl-2 pr-2.5 text-[0.625rem] font-medium leading-none text-primary/90 shadow-sm backdrop-blur-sm animate-in fade-in duration-150"
        aria-hidden="true"
      >
        <PenLine className="size-2.5" />
        Editing
      </div>
      <FloatingElement
        editor={editor}
        shouldShow={hasSelection || isTransforming}
        placement="top"
        offsetValue={8}
      >
        <div className="rounded-xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur-md w-[min(34rem,calc(100vw-2rem))]">
          {/* Primary transforms */}
          <div className="flex items-center gap-0.5 p-1.5">
            {PRIMARY_TRANSFORMS.map(({ mode, icon: Icon, label }) => (
              <Button
                key={mode}
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs gap-1.5"
                onClick={() => applySelectionTransform(mode)}
                disabled={isTransforming || !hasSelection}
              >
                {isTransforming && selectionTransformMode === mode
                  ? <Loader2 className="size-3 animate-spin" />
                  : <Icon className="size-3" />}
                {label}
              </Button>
            ))}
            {showTransformUndo && !isTransforming && (
              <div className="flex items-center ml-auto pl-1 border-l border-border/30">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[0.625rem] gap-1 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    editor?.commands.undo()
                    setShowTransformUndo(false)
                  }}
                >
                  <Undo2 className="size-2.5" />
                  Undo
                </Button>
              </div>
            )}
          </div>
          {/* Custom transforms */}
          {enabledTransforms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5 border-t border-border/30 pt-1.5">
              {enabledTransforms.map(t => (
                <Button
                  key={t.id}
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[0.625rem] text-muted-foreground hover:text-foreground/80"
                  onClick={() => applySelectionTransform('custom', t.instruction, t.label)}
                  disabled={isTransforming || !hasSelection}
                >
                  {isTransforming && selectionTransformMode === 'custom' && customTransformLabel === t.label
                    ? <Loader2 className="size-2.5 animate-spin mr-1" />
                    : null}
                  {t.label}
                </Button>
              ))}
            </div>
          )}
          {/* Reasoning stream */}
          {(isTransforming || selectionTransformReasoning.trim()) && (
            <div className="border-t border-border/50 px-2.5 py-2">
              <p className="mb-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground">Reasoning</p>
              <div className="max-h-36 overflow-y-auto overscroll-contain pr-1">
                <p className="text-[0.6875rem] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {selectionTransformReasoning.trim() || 'Thinking\u2026'}
                </p>
              </div>
            </div>
          )}
        </div>
      </FloatingElement>
      <EditorContent editor={editor} />
      <div className="pointer-events-none absolute -bottom-[10px] left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 whitespace-nowrap text-[0.625rem] leading-none text-muted-foreground/70 animate-in fade-in duration-150">
        <span className="hidden sm:inline">Ctrl+S save &middot; Esc discard &middot; Ctrl+&crarr; done</span>
        <span className="sm:hidden">Ctrl+S &middot; Esc</span>
        <span className="hidden sm:inline font-mono tabular-nums text-muted-foreground/50">
          {editorStats.words.toLocaleString()}w
          &middot; {editorStats.chars.toLocaleString()}c
          &middot; ~{editorStats.tokens.toLocaleString()}t
          &middot; {editorStats.paragraphs}&para;
          &middot; {readingTime(editorStats.words)} read
        </span>
      </div>
      {saveState !== 'idle' && (
        <div
          className="absolute -bottom-[10px] right-3 flex items-center gap-1 rounded-md border border-border/30 bg-popover/90 px-1.5 py-0.5 text-[0.625rem] leading-none text-muted-foreground shadow-sm backdrop-blur animate-in fade-in duration-150 pointer-events-none"
          aria-live="polite"
        >
          {saveState === 'saving' && (
            <>
              <Loader2 className="size-2.5 animate-spin" />
              Saving
            </>
          )}
          {saveState === 'saved' && (
            <>
              <Check className="size-2.5 text-emerald-500/80" />
              Saved
            </>
          )}
          {saveState === 'error' && (
            <>
              <AlertTriangle className="size-2.5 text-destructive" />
              Save failed
            </>
          )}
        </div>
      )}
    </div>
  )
}
