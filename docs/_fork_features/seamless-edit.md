# Seamless Edit

**Added:** 2026-08-23 · **Status:** stable · **Upstreamable:** maybe
**Commit trailer:** `Fork-Feature: seamless-edit`
**Dependencies:** `fix-bool-pref-sync`

Clicking **Edit** on a prose passage replaces the rendered text with a Tiptap
editor in the same container. This preserves the view and scroll position.
Blur, `Ctrl+S`, or `Ctrl+Enter` saves; `Esc` discards. The selection transform
toolbar is available while editing. A browser preference enables the feature
by default and keeps the original writing panel available as a fallback.

## Paths

New (3):

- `src/components/prose/SeamlessProseEditor.tsx`: inline editor, session control,
  saves, selection transforms, display-only text styling, the floating
  "Editing" chip, and the hint/stats footer
- `src/lib/prose-editor-content.ts`: plain-text document conversion, selection
  range lookup, click-anchor reading, and dialogue/emphasis scanning
- `tests/lib/prose-editor-content.test.ts`: conversion and styling scanner tests

Modified (3):

- `src/components/prose/ProseBlock.tsx`: starts and owns the inline edit session;
  edit mode tints the container primary (distinct from hover/actions states)
- `src/components/sidebar/SettingsPanel.tsx`: adds the Interface preference
- `src/lib/theme.tsx`: exposes `useSeamlessEdit` through `useBoolPref`

Shared:

- `src/lib/theme.tsx` with `fix-bool-pref-sync`
- Likely upstream conflicts: `ProseBlock.tsx` and `SettingsPanel.tsx`

The fallback `ProseWritingPanel.tsx`, `ProseChainView.tsx`, and server/API files
are not changed. The preference is browser-local, not a story setting.

## Contracts

- **Lossless text:** `fragment.content -> plainTextToDoc -> editor ->
  getText({ blockSeparator: '\n\n' }) -> fragment.content` must preserve the
  original text. Paragraphs use `\n\n`; single newlines use hard breaks. Keep
  this conversion aligned with `ProseWritingPanel`.
- **Matching typography:** the editor uses `prose-content font-prose` and
  `[&_p+p]:mt-[0.85em]!`. The spacing must match StreamMarkdown's prose
  variant (`mb-[0.85em]`). The `!` is required to override the unlayered
  `.ProseMirror p + p` rule in `styles.css`.
- **Display-only styling:** dialogue and Markdown emphasis are decorations,
  not document marks. Saved text retains its literal markers. Keep the
  dialogue pattern aligned with `character-mentions.ts` and emphasis behavior
  aligned with StreamMarkdown/CommonMark. Styling precedence is dialogue,
  star emphasis, then underscore emphasis. Inside dialogue, emphasis is not
  styled and its markers are dimmed.
- **One editor:** a module-level registry allows one seamless editor at a
  time. Opening another editor ends and saves the current session.
- **Safe saves:** unchanged text is not written. `Esc` prevents teardown from
  saving discarded text. Unmounting saves changed text unless the edit was
  cancelled or a save is already running.
- **Bound session:** an edit remains tied to the fragment selected when the
  session began. If the active variation changes, the captured fragment is
  saved and the editor closes.
- **Safe transforms:** save, discard, and blur are disabled while a selection
  transform streams. The replacement range follows transactions made during
  the stream so typing cannot move the result to the wrong place.
- **Overlay anchoring:** the Editing chip, hint/stats footer, and save pill
  are absolute offsets tuned to the container's `p-4` and `.prose-content`
  leading (`-top-6`, `-bottom-[10px]`); retune all three if either changes.
- **Stable entry point:** the Edit button retains
  `data-component-id="prose-<id>-edit"`.
- **Click-anchored caret:** with no text selected, the toolbar-opening click
  records an approximate plain-text offset (`readCaretAnchor` in
  `prose-editor-content.ts`, mapped by `findPlainTextPos`), so the
  editor's caret starts near where the user clicked instead of at the end.
  An explicit selection still wins over the offset. The same anchor also
  disambiguates repeated phrases when restoring a selection
  (`findPlainTextRange` picks the occurrence nearest it).
- **Double-click edits:** double-clicking a passage opens the inline editor
  directly, caret anchored at the click. The handler sits on the outer block
  because a double-click's second press is often swallowed by the instantly
  mounted toolbar overlay; passage text and idle toolbar chrome become
  edits, while panel buttons and variation rails keep their own semantics.
  When the press landed on toolbar chrome, the caret lookup resolves
  over the overlay, so the first click's stored anchor stands in. The word
  selection a double-click creates is discarded so editing starts as a
  caret. With the preference off it falls through to the writing panel.
  The action toolbar floats above the click line (below it near the block
  top) so it never spawns underneath the pointer.

## Deliberate Tradeoffs

- `applySelectionTransform` and about 65 lines of toolbar JSX duplicate code
  from `ProseWritingPanel`. Sharing it would add another upstream-sensitive
  file to this feature. If panel transforms change, port the change and verify
  the `transformProseSelection` call shape.
- The footer's stats and reading-time helpers (~15 lines) mirror
  `ProseWritingPanel`'s footer logic for the same reason: sharing would widen
  the feature's path surface. Keep thresholds (238 wpm, ~4 chars/token) in
  sync if either changes.
- The preference defaults to on in the fork. Change the `useSeamlessEdit`
  default to `false` when preparing an upstream PR.

## Known Edges

- Markdown emphasis markers remain visible but dimmed while editing. Styled
  text resembles the read view, while the plain-text model keeps saves
  byte-identical. Mention highlights remain read-view-only, and the original
  writing panel continues to show raw source.
- Switching variation while editing saves the captured fragment and exits.
- The click-anchored caret can drift a few characters from the exact click
  point: read-view emphasis/dialogue markers are absent from the plain-text
  model, and hard breaks contribute no offset length. Unresolvable clicks
  (padding, keyboard-opened toolbar) fall back to cursor-at-end.
- The preference is per browser, not per story.

## Upstream Extraction

- Extract `fix-bool-pref-sync` first.
- Check conflicts around StreamMarkdown paragraph margins, the global
  `.ProseMirror p + p` rule, `StarterKit.configure`, `FloatingElement`, the
  `ProseBlock` action toolbar, and the dialogue regex in
  `character-mentions.ts`.

## Verification

- [ ] `bunx vitest run tests/lib/prose-editor-content.test.ts && bun run test && bunx tsc --noEmit`
- [ ] Edit and type, then click away: changes save and the Undo pill appears.
- [ ] `Esc` discards; `Ctrl+S` saves without closing.
- [ ] Rewrite, Expand, Compress, and custom transforms work while editing.
- [ ] Entering and leaving edit mode does not shift width or paragraph spacing.
- [ ] Edit mode is clearly distinct from read view (primary tint, Editing chip)
  without moving the text.
- [ ] Footer shows live w/c/t/&para;/read stats and shortcut hints in the bottom
  padding without covering prose or colliding with the save pill.
- [ ] Click Edit with no selection: the caret starts near the clicked point.
- [ ] Double-click a word: the editor opens with the caret at that word, nothing pre-highlighted.
- [ ] Opening editor B saves and closes editor A.
- [ ] Dialogue and emphasis style live; saved text retains literal markers.
- [ ] Turning the setting off makes Edit open `ProseWritingPanel`.
