# POV Voice

**Added:** 2026-08-22 · **Status:** stable · **Upstreamable:** maybe
**Commit trailer:** `Fork-Feature: pov-voice`
**Dependencies:** `fix-conversation-index-lock`

Authors can generate prose from a selected character's point of view using
voice notes stored in `meta.voice`. The picker is stored per story in browser
storage; no selection means narrator. Voice notes remain author-controlled
except for the explicit `setCharacterVoice` chat tool.

## Coverage

| Flow | Behavior |
|---|---|
| Generate, Preview, Regenerate, Refine | Uses the picker |
| Prewriter | Planner sees the voice block; writer receives it after the brief |
| ProseBlock regenerate/refine actions | API wrappers attach the picker value |
| Librarian prose-refine chat | Captures POV when the conversation is created |
| General librarian chat | No POV |
| Fragment refine / optimize-character | Reads the target character's voice only |
| Writer and librarian block editors | Expose the `pov-voice` block |

The block is a template containing `{{characterName}}` and `{{voice}}`. Tokens
resolve after block overrides, so custom content controls placement and can
omit `{{voice}}`.

## Paths

New (6):

- `src/components/generation/PovSelect.tsx`: POV picker
- `src/components/fragments/VoiceField.tsx`: debounced voice-note editor
- `src/server/librarian/character-voice-tool.ts`: author-requested voice tool
- `tests/llm/pov-voice.test.ts`
- `tests/agents/pov-agent-blocks.test.ts`
- `tests/librarian/character-voice-tool.test.ts`

Modified (19):

- `src/server/llm/context-builder.ts`: voice block creation and token resolution
- `src/server/routes/generation.ts`: POV input and generation threading
- `src/server/routes/agent-blocks.ts`: resolved previews and editable templates
- `src/server/llm/prewriter.ts`: voice block after the writing brief
- `src/server/agents/compile-agent-context.ts`: post-override token resolution
- `src/server/llm/agents.ts`: preview voice context
- `src/server/agents/agent-block-context.ts`: optional POV context type
- `src/server/agents/block-helpers.ts`: target character voice in read context
- `src/server/librarian/chat.ts`: prose-refine POV context and tool
- `src/server/librarian/blocks.ts`: chat block, preview, and tool instructions
- `src/server/librarian/agents.ts`: tool schema and registration
- `src/server/librarian/storage.ts`: conversation POV metadata
- `src/server/routes/librarian.ts`: capture and load conversation POV
- `src/lib/api/librarian.ts`: POV on conversation creation
- `src/lib/api/generation.ts`: picker storage and automatic request attachment
- `src/components/generation/GenerationPanel.tsx`: picker UI
- `src/components/prose/InlineGenerationInput.tsx`: picker UI
- `src/components/sidebar/LibrarianPanel.tsx`: prose-refine POV capture
- `src/components/fragments/FragmentEditor.tsx`: voice-note field

Shared:

- `src/server/librarian/storage.ts` with `fix-conversation-index-lock`
- Likely upstream conflicts: `context-builder.ts`, `routes/generation.ts`,
  `prewriter.ts`, `compile-agent-context.ts`, and `librarian/blocks.ts`

## Contracts

- `pov-voice` is a built-in user-role block. Its order is 650 in standard
  generation, 250 in writer briefs, and 500 in librarian chat.
- Block content retains `{{characterName}}` and `{{voice}}` through default
  creation and overrides. Resolution order is `createDefaultBlocks ->
  applyBlockConfig -> resolve -> plugins -> compile`.
- Preview endpoints resolve tokens. The list endpoint does not, so Replace
  starts with editable tokens.
- `meta.voice` is AI-immutable by default. Existing storage writes preserve it,
  and normal tool schemas cannot set it. Only `setCharacterVoice` and the
  author-facing `VoiceField` may change it.
- Fragment refinement may read target voice notes but cannot write them.
- General librarian chat has no POV path. Prose-refine captures the character
  on the conversation record and loads it server-side for later messages.
- All four generation stream wrappers attach the current picker value.
  Components do not thread it. The picker overrides an explicit
  `ClarifyOpts.povCharacterId` from callers.
- Voice text is stored verbatim. Blank-after-trim input removes the key.

## Deliberate Tradeoffs

- Plugin SDK types do not expose `scriptContext.povVoice` because no plugin
  consumes it. Add the type if a plugin needs it.
- The block editor has no separate token hint because the template displays
  the tokens directly.
- POV selection is browser-local rather than a story setting.

## Known Edges

- An unsaved voice draft can be lost if the fragment changes without blur.
  Normal pointer navigation triggers blur first.
- Generation reads the current picker and voice notes on each request.
- Prose-refine conversations keep the selected character from creation but
  re-read that character's voice notes on each request.
- Existing chat messages keep their original wording after voice notes change.

## Upstream Extraction

- Extract `fix-conversation-index-lock` first.
- Check block ordering, generation schemas and resolver calls, prewriter
  signatures, agent compilation, librarian tool instructions, target fragment
  context, generation API wrappers, and conversation creation/chat routes.

## Verification

- [ ] `bunx vitest run tests/llm/pov-voice.test.ts tests/agents/pov-agent-blocks.test.ts tests/librarian/character-voice-tool.test.ts && bun run test`
- [ ] `bunx tsc --noEmit`
- [ ] Pick a POV and verify generate, regenerate, and prose-refine use it.
- [ ] Verify general chat does not receive POV.
- [ ] Verify writer and librarian block editors list `pov-voice`.
