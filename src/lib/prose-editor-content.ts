import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Display-only styling scan for the seamless editor: finds the ranges the
 * read view styles (markdown emphasis, quoted dialogue) so decorations can
 * mirror them live while typing. Purely visual — the model stays plain text,
 * so saves are byte-identical.
 */

// Mirrors character-mentions' dialogue regex (" and curly quotes, shortest
// span between two quote chars); duplicated because that module only exports
// React helpers. Keep in sync.
const DIALOGUE_RE = /["\u201c\u201d][^"\u201c\u201d]*?["\u201d\u201c]/g

// CommonMark-shaped: backreference forces equal-length markers (`**bold**`
// matches, `**odd*` doesn't), no whitespace-flanked or multiline content,
// intraword underscores ignored.
const STAR_EMPHASIS_RE = /(\*{1,3})(?=\S)([^*\n]*?\S)\1/g
const UNDERSCORE_EMPHASIS_RE = /(?<![\w`])(_{1,3})(?=\S)([^_\n]*?\S)\1(?![\w`])/g

export type InlineStyleKind = 'dialogue' | 'em' | 'strong' | 'em-strong'

export interface StyledRange {
  from: number
  to: number
  kind: InlineStyleKind
}

/** A literal markdown delimiter run to render recessively (dimmed). */
export interface MarkerRange {
  from: number
  to: number
}

export interface InlineStyleScan {
  styled: StyledRange[]
  markers: MarkerRange[]
}

function overlaps(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && b.from < a.to
}

function emphasisKind(marker: string): InlineStyleKind {
  if (marker.length === 1) return 'em'
  if (marker.length === 2) return 'strong'
  return 'em-strong'
}

function collectEmphasis(
  text: string,
  regex: RegExp,
  styled: StyledRange[],
  markers: MarkerRange[],
  taken: Array<{ from: number; to: number }>,
): void {
  for (const m of text.matchAll(regex)) {
    const range = { from: m.index!, to: m.index! + m[0].length }
    const delimiters = [
      { from: range.from, to: range.from + m[1].length },
      { from: range.to - m[1].length, to: range.to },
    ]
    // Precedence: dialogue > star > underscore; leftmost within a pass. A
    // loser keeps opaque markers, except delimiters inside a quote get dimmed
    // (the read view strips those chars entirely). A */_ run never straddles
    // a quote, so containment is exact.
    if (taken.some((t) => overlaps(t, range))) {
      for (const d of delimiters)
        if (styled.some((s) => s.kind === 'dialogue' && s.from <= d.from && d.to <= s.to)) markers.push(d)
      continue
    }
    taken.push(range)
    styled.push({ ...range, kind: emphasisKind(m[1]) })
    markers.push(...delimiters)
  }
}

/** Find display-styled ranges + dimmable marker runs within one text node. */
export function scanInlineStyling(text: string): InlineStyleScan {
  const styled: StyledRange[] = []
  const markers: MarkerRange[] = []

  // Quoted spans win, mirroring stripEmphasisInDialogue in the read view.
  const taken: Array<{ from: number; to: number }> = []
  for (const m of text.matchAll(DIALOGUE_RE)) {
    const range = { from: m.index!, to: m.index! + m[0].length }
    taken.push(range)
    styled.push({ ...range, kind: 'dialogue' })
  }

  collectEmphasis(text, STAR_EMPHASIS_RE, styled, markers, taken)
  collectEmphasis(text, UNDERSCORE_EMPHASIS_RE, styled, markers, taken)

  return { styled, markers }
}

export interface ProseInlineNodeJson {
  type: 'text' | 'hardBreak'
  text?: string
}

export interface ProseParagraphJson {
  type: 'paragraph'
  content?: ProseInlineNodeJson[]
}

export interface ProseDocJson {
  type: 'doc'
  content: ProseParagraphJson[]
}

/**
 * Plain-text ⇄ ProseMirror document conversion for the prose editors.
 *
 * Mirrors the inline copy in ProseWritingPanel so both editors round-trip
 * fragment.content identically: paragraphs split on \n\n, single \n becomes
 * a hardBreak. Keep in sync if either changes.
 */
export function plainTextToDoc(content: string): ProseDocJson {
  if (!content.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  return {
    type: 'doc',
    content: content.split('\n\n').map((para) => {
      if (!para) return { type: 'paragraph' as const }
      const lines = para.split('\n')
      if (lines.length === 1) {
        return { type: 'paragraph' as const, content: [{ type: 'text' as const, text: lines[0] }] }
      }
      const inline: ProseInlineNodeJson[] = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) inline.push({ type: 'text', text: lines[i] })
        if (i < lines.length - 1) inline.push({ type: 'hardBreak' })
      }
      return { type: 'paragraph' as const, content: inline.length > 0 ? inline : [] }
    }),
  }
}

/** Plain text (blockSeparator '\n\n') offset → ProseMirror range, or null when absent. */
export function findPlainTextRange(
  doc: ProseMirrorNode,
  searchText: string,
  /** Occurrence hint ('\n\n' coords): repeated phrases resolve to the start nearest it. */
  hint?: number | null,
): { from: number; to: number } | null {
  const docText = doc.textBetween(0, doc.content.size, '\n\n')
  let idx = -1
  for (let at = docText.indexOf(searchText); at !== -1; at = docText.indexOf(searchText, at + 1)) {
    if (idx === -1 || (hint != null && Math.abs(at - hint) < Math.abs(idx - hint))) idx = at
  }
  if (idx === -1) return null

  const endIdx = idx + searchText.length
  let charsSeen = 0
  let from = -1
  let to = -1
  doc.descendants((node, pos) => {
    if (to !== -1) return false
    if (node.isText) {
      const start = charsSeen
      const end = charsSeen + node.text!.length
      if (from === -1 && idx >= start && idx < end) {
        from = pos + (idx - start)
      }
      if (from !== -1 && endIdx >= start && endIdx <= end) {
        to = pos + (endIdx - start)
        return false
      }
      charsSeen = end
    } else if (node.isBlock && charsSeen > 0) {
      charsSeen += 2
    }
    return true
  })

  return from !== -1 && to !== -1 ? { from, to } : null
}

/**
 * Clicked point in rendered prose → plain-text offset ('\n\n' coords) for
 * anchoring the seamless editor's caret; marker stripping drifts it a few
 * chars. Null on pre-standard engines or overlay points — callers fall back.
 */
export function readCaretAnchor(container: Element | null, x: number, y: number): number | null {
  if (!container) return null
  const pos = document.caretPositionFromPoint?.(x, y)
  const node = pos?.offsetNode
  if (!node || !container.contains(node)) return null
  const para = (node instanceof Element ? node : node.parentElement)?.closest('p')
  if (!para) return null
  const paraIndex = [...container.querySelectorAll('p')].indexOf(para)
  if (paraIndex === -1) return null
  const before = document.createRange()
  before.selectNodeContents(container)
  before.setEnd(node, pos.offset)
  return before.toString().length + paraIndex * 2
}

/** Plain-text ('\n\n'-separated) offset → nearest ProseMirror position; clamps past-the-end, null when the doc has no text. */
export function findPlainTextPos(doc: ProseMirrorNode, offset: number): number | null {
  const target = Math.max(0, offset)
  let charsSeen = 0
  let found = -1
  let endPos = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText) {
      const len = node.text?.length ?? 0
      endPos = pos + len
      if (target <= charsSeen + len) {
        found = pos + Math.max(0, target - charsSeen)
        return false
      }
      charsSeen += len
    } else if (node.isBlock && charsSeen > 0) {
      charsSeen += 2
      if (target < charsSeen) {
        found = pos + 1
        return false
      }
    }
    return true
  })
  return found !== -1 ? found : endPos !== -1 ? endPos : null
}
