import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  findPlainTextPos,
  findPlainTextRange,
  plainTextToDoc,
  scanInlineStyling,
} from '@/lib/prose-editor-content'

// Minimal ProseMirror schema mirroring the doc tiptap builds:
// doc > paragraph > (text | hardBreak)
const schema = new Schema({
  nodes: {
    text: {},
    hardBreak: { inline: true, group: 'inline', selectable: false },
    paragraph: { group: 'block', content: 'inline*' },
    doc: { content: 'block+' },
  },
})

function buildDoc(content: string): ProseMirrorNode {
  return schema.nodeFromJSON({ type: 'doc', content: plainTextToDoc(content).content })
}

/** Doc as plain text again, with '\n' per hardBreak (textBetween drops them). */
function sourceText(doc: ProseMirrorNode): string {
  const parts: string[] = []
  doc.forEach((para) => {
    let text = ''
    para.forEach((inline) => {
      if (inline.isText) text += inline.text
      else if (inline.type.name === 'hardBreak') text += '\n'
    })
    parts.push(text)
  })
  return parts.join('\n\n')
}

/** Inline node types of a paragraph, e.g. 'text,hardBreak,text'. */
function inlineTypes(doc: ProseMirrorNode, para = 0): string {
  const names: string[] = []
  doc.content.child(para).forEach((n) => names.push(n.type.name))
  return names.join(',')
}

describe('plainTextToDoc', () => {
  it('treats blank input as an empty paragraph', () => {
    const empty = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(plainTextToDoc('')).toEqual(empty)
    expect(plainTextToDoc('   \n\n  ')).toEqual(empty)
  })

  it('splits \\n\\n into paragraphs and \\n into hardBreaks', () => {
    expect(plainTextToDoc('First.\n\nSecond.').content).toHaveLength(2)
    expect(inlineTypes(buildDoc('Line one\nLine two'))).toBe('text,hardBreak,text')
  })

  it('round-trips losslessly through a ProseMirror doc', () => {
    const source = 'Para one line A\nline B.\n\nPara two.'
    expect(sourceText(buildDoc(source))).toBe(source)
  })
})

describe('findPlainTextRange', () => {
  it('maps substrings onto positions, including across a hardBreak', () => {
    const cases = [
      ['Alpha beta.\n\nGamma delta.', 'Gamma delta'],
      ['One\ntwo three.', 'two three'],
    ] as const
    for (const [content, search] of cases) {
      const doc = buildDoc(content)
      const range = findPlainTextRange(doc, search)!
      expect(doc.textBetween(range.from, range.to)).toBe(search)
    }
  })

  it('is null when the text is absent', () => {
    expect(findPlainTextRange(buildDoc('Nothing here.'), 'missing text')).toBeNull()
  })

  it('prefers the occurrence nearest a hint offset', () => {
    const doc = buildDoc('Echo one.\n\nEcho two.')
    expect(doc.textBetween(0, findPlainTextRange(doc, 'Echo')!.from, '\n\n')).toBe('')
    // Hint at para two's start picks its 'Echo'; smaller hints keep the first.
    expect(doc.textBetween(0, findPlainTextRange(doc, 'Echo', 11)!.from, '\n\n')).toBe('Echo one.\n\n')
    expect(doc.textBetween(0, findPlainTextRange(doc, 'Echo', 2)!.from, '\n\n')).toBe('')
  })
})

describe('findPlainTextPos', () => {
  const doc = buildDoc('Alpha beta.\n\nGamma delta.')

  it('maps offsets to carets, counting the \\n\\n separator', () => {
    expect(doc.textBetween(0, findPlainTextPos(doc, 5)!)).toBe('Alpha')
    expect(doc.textBetween(0, findPlainTextPos(doc, 13)!, '\n\n')).toBe('Alpha beta.\n\n')
  })

  it('snaps gap offsets forward and clamps past the end', () => {
    expect(doc.textBetween(0, findPlainTextPos(doc, 12)!, '\n\n')).toBe('Alpha beta.\n\n')
    expect(doc.textBetween(0, findPlainTextPos(doc, 999)!, '\n\n')).toBe('Alpha beta.\n\nGamma delta.')
  })

  it('handles hardBreak paragraphs and empty docs', () => {
    const br = buildDoc('One\ntwo three.')
    expect(br.textBetween(0, findPlainTextPos(br, 3)!)).toBe('One')
    expect(findPlainTextPos(buildDoc(''), 0)).toBeNull()
  })
})

describe('scanInlineStyling', () => {
  const kinds = (text: string) => scanInlineStyling(text).styled
  const marks = (text: string) => scanInlineStyling(text).markers

  it('leaves plain and unflanked markup untouched', () => {
    const plain = ['No styling in sight.', '5 * 3 = 15', '*line one\nline two*', '**bold never', 'var snake_case_name here']
    for (const text of plain) expect(scanInlineStyling(text)).toEqual({ styled: [], markers: [] })
  })

  it('styles straight- and curly-quoted dialogue', () => {
    expect(kinds('He said "Hello there." twice')).toEqual([{ from: 8, to: 22, kind: 'dialogue' }])
    expect(kinds('She whispered \u201cnot now\u201d softly.')).toEqual([{ from: 14, to: 23, kind: 'dialogue' }])
  })

  it('maps marker length to em / strong / em-strong and reports markers', () => {
    expect(kinds('A *quiet* moment')).toEqual([{ from: 2, to: 9, kind: 'em' }])
    expect(marks('A *quiet* moment')).toEqual([{ from: 2, to: 3 }, { from: 8, to: 9 }])
    expect(kinds('**bold** move')).toEqual([{ from: 0, to: 8, kind: 'strong' }])
    expect(marks('**bold** move')).toEqual([{ from: 0, to: 2 }, { from: 6, to: 8 }])
    expect(kinds('***both***')).toEqual([{ from: 0, to: 10, kind: 'em-strong' }])
    expect(kinds('a _em_ b')).toEqual([{ from: 2, to: 6, kind: 'em' }])
  })

  it('resolves mismatched stars like CommonMark: outer literal, inner em', () => {
    expect(kinds('**odd* rest')).toEqual([{ from: 1, to: 6, kind: 'em' }])
    expect(marks('**odd* rest')).toEqual([{ from: 1, to: 2 }, { from: 5, to: 6 }])
  })

  it('skips emphasis styling inside dialogue but dims its markers', () => {
    const scan = scanInlineStyling('He said "*not really*" aloud')
    expect(scan.styled).toEqual([{ from: 8, to: 22, kind: 'dialogue' }])
    expect(scan.markers).toEqual([{ from: 9, to: 10 }, { from: 20, to: 21 }])
  })

  it('resolves star/underscore overlap by pass order, markers stay opaque', () => {
    const scan = scanInlineStyling('_a *b* c_')
    expect(scan.styled).toEqual([{ from: 3, to: 6, kind: 'em' }])
    expect(scan.markers).toEqual([{ from: 3, to: 4 }, { from: 5, to: 6 }])
  })
})
