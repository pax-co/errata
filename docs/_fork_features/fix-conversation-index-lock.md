# Conversation Index Lock

**Added:** 2026-08-22 · **Status:** stable · **Upstreamable:** yes
**Commit trailer:** `Fork-Feature: fix-conversation-index-lock`
**Dependencies:** none

All writers to `librarian/conversations.json` now share a per-story lock.
Previously, concurrent read-modify-write operations could silently drop records.
A common trigger was a background history save finishing while the next
conversation was created.

## Paths

New (1):

- `tests/librarian/conversation-storage.test.ts`: covers concurrent creates
  and late history saves

Modified (1):

- `src/server/librarian/storage.ts`: wraps all conversation-index mutations in
  the existing `withIndexLock`

Shared:

- `src/server/librarian/storage.ts` with `pov-voice`

## Contracts

- Every mutation of `conversations.json` holds `withIndexLock(storyId)`.
- A background history save must not overwrite a conversation created while
  that save was running.
- New conversation-index writers must use the same lock.

## Deliberate Tradeoffs

- Reads remain unlocked. They may briefly see an older index, which is
  acceptable and avoids serializing read-only work.

## Upstream Extraction

- Check the four locked functions in `storage.ts`.
- If upstream adds another index writer, protect it with the same lock.

## Verification

- [ ] `bunx vitest run tests/librarian/conversation-storage.test.ts tests/api/librarian-routes.test.ts && bun run test`
