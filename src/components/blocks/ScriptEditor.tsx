import { useMemo } from 'react'
import CodeMirror, { EditorView, type ReactCodeMirrorProps } from '@uiw/react-codemirror'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  indentOnInput,
  indentUnit,
} from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { cn } from '@/lib/utils'
import {
  ctxCompletionSource,
  storyCompletionSource,
  fragmentPropertyCompletionSource,
  makeFragmentIdCompletionSource,
  type FragmentHint,
} from './ScriptEditor.completions'

// ── Highlight style (reads from CSS variables in styles.css) ────

const errataHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: 'var(--cm-keyword)', fontWeight: '500' },
  { tag: [t.string, t.special(t.string)], color: 'var(--cm-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--cm-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [t.variableName, t.propertyName], color: 'var(--cm-ident)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--cm-function)' },
  { tag: [t.className, t.typeName, t.namespace], color: 'var(--cm-type)' },
  { tag: [t.operator, t.punctuation, t.separator], color: 'color-mix(in oklch, var(--cm-ident) 60%, transparent)' },
  { tag: [t.angleBracket, t.squareBracket, t.brace, t.paren], color: 'var(--cm-ident)' },
  { tag: [t.regexp], color: 'var(--cm-string)' },
  { tag: [t.escape], color: 'var(--cm-number)' },
  { tag: [t.invalid], color: 'var(--destructive)' },
])

// ── Outer theme (chrome) ────────────────────────────────────────

const errataTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--cm-ident)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
    lineHeight: '1.55',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '0.625rem 0.875rem',
    caretColor: 'var(--cm-keyword)',
    minHeight: '80px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 2px' },
  '.cm-activeLine': { backgroundColor: 'var(--cm-active-line)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--cm-selection)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--cm-selection)',
  },
  '&.cm-focused .cm-matchingBracket': {
    outline: '1px solid color-mix(in oklch, var(--cm-keyword) 50%, transparent)',
    backgroundColor: 'transparent',
    borderRadius: '2px',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    outline: '1px solid color-mix(in oklch, var(--destructive) 60%, transparent)',
    backgroundColor: 'transparent',
  },
  '.cm-cursor': {
    borderLeftWidth: '1.5px',
    borderLeftColor: 'var(--cm-keyword)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
    borderRadius: '8px',
    boxShadow: '0 4px 14px color-mix(in oklch, var(--foreground) 10%, transparent)',
    padding: '2px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-mono)',
    maxHeight: '12rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'color-mix(in oklch, var(--cm-keyword) 12%, transparent)',
    color: 'var(--cm-ident)',
  },
  '.cm-completionIcon': { opacity: 0.55, marginRight: '0.25rem' },
  '.cm-completionLabel': { color: 'var(--cm-ident)' },
  '.cm-completionDetail': {
    color: 'var(--cm-comment)',
    fontStyle: 'italic',
    marginLeft: '0.5rem',
  },
})

// ── Extensions bundle ───────────────────────────────────────────

function buildExtensions(
  readOnly: boolean,
  dynamicSources: CompletionSource[],
) {
  // Register each completion source individually against the JS language
  // data. Each needs its own .data.of() call — passing an array as the
  // `autocomplete` value silently fails because CM expects a single
  // CompletionSource per facet entry.
  const languageCompletions = [
    ctxCompletionSource,
    storyCompletionSource,
    fragmentPropertyCompletionSource,
    ...dynamicSources,
  ].map(source => javascriptLanguage.data.of({ autocomplete: source }))

  const base = [
    javascript({ jsx: false, typescript: false }),
    ...languageCompletions,
    history(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    autocompletion({
      activateOnTyping: true,
      closeOnBlur: true,
      defaultKeymap: true,
    }),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    syntaxHighlighting(errataHighlight),
    errataTheme,
    keymap.of([
      ...completionKeymap,
      ...closeBracketsKeymap,
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
  ]
  if (readOnly) base.push(EditorState.readOnly.of(true))
  return base
}

// ── Component ───────────────────────────────────────────────────

export interface ScriptEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  minHeight?: string
  height?: string
  maxHeight?: string
  /** Adds a hairline destructive border — signal that the live eval errored. */
  hasError?: boolean
  /** Visually disables editing (still selectable). */
  readOnly?: boolean
  /** Focus the editor on mount. Off by default to avoid stealing focus. */
  autoFocus?: boolean
  /**
   * Fragment hints — when provided, completions suggest fragment IDs inside
   * `ctx.getFragment('…')` calls and fragment type names inside
   * `ctx.getFragments('…')`.
   */
  fragmentHints?: FragmentHint[]
  className?: string
  /** DOM attribute for component targeting. */
  dataComponentId?: string
}

export function ScriptEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  minHeight = '80px',
  height,
  maxHeight,
  hasError = false,
  readOnly = false,
  autoFocus = false,
  fragmentHints,
  className,
  dataComponentId,
}: ScriptEditorProps) {
  // Wrap the fragmentHints in a ref-like getter so the completion source
  // re-reads the latest array on each invocation without re-building the
  // extension set (which would reset the editor state on every fetch).
  const hintsRef = useMemo(() => ({ current: fragmentHints ?? [] }), []) // eslint-disable-line react-hooks/exhaustive-deps
  hintsRef.current = fragmentHints ?? []

  const extensions = useMemo(
    () => buildExtensions(readOnly, [makeFragmentIdCompletionSource(() => hintsRef.current)]),
    [readOnly, hintsRef],
  )

  const wrapperClass = cn(
    'rounded-md border transition-colors',
    'bg-muted/20',
    hasError
      ? 'border-destructive/50 focus-within:border-destructive/70'
      : 'border-border/30 focus-within:border-border/70',
    className,
  )

  const basicSetup: ReactCodeMirrorProps['basicSetup'] = {
    // We disable everything we don't want from the default preset.
    lineNumbers: false,
    foldGutter: false,
    highlightActiveLineGutter: false,
    highlightActiveLine: true,
    syntaxHighlighting: false, // we ship our own
    bracketMatching: false,    // we ship our own
    closeBrackets: false,      // ditto
    autocompletion: false,     // ditto
    indentOnInput: false,      // ditto
    defaultKeymap: false,      // ditto
    historyKeymap: false,      // ditto
    completionKeymap: false,   // ditto
    closeBracketsKeymap: false,
    history: false,            // ditto
    searchKeymap: false,
    drawSelection: true,
    dropCursor: true,
    allowMultipleSelections: true,
    rectangularSelection: true,
    crosshairCursor: false,
    highlightSelectionMatches: true,
    lintKeymap: false,
    foldKeymap: false,
  }

  return (
    <div className={wrapperClass} data-component-id={dataComponentId}>
      <CodeMirror
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        extensions={extensions}
        basicSetup={basicSetup}
        minHeight={minHeight}
        height={height}
        maxHeight={maxHeight}
        theme="none"
        indentWithTab={false}
        autoFocus={autoFocus}
      />
    </div>
  )
}
