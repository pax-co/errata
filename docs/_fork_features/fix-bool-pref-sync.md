# Bool Pref Sync

**Added:** 2026-08-23 · **Status:** stable · **Upstreamable:** yes
**Commit trailer:** `Fork-Feature: fix-bool-pref-sync`
**Dependencies:** none

Boolean preference hooks previously cached separate values. Changing a setting
updated Settings but not other mounted components until reload. Browser storage
is now the source of truth, and same-tab events make every hook update at once.

## Paths

New (0): none.

Modified (1):

- `src/lib/theme.tsx`: `useBoolPref` now reads storage with
  `useSyncExternalStore`; writes update storage and dispatch `<key>-change`

Shared:

- `src/lib/theme.tsx` with `seamless-edit`

## Contracts

- Components read the current storage value instead of caching a local copy.
- Every boolean preference write dispatches `<key>-change` so mounted hooks
  update immediately.
- Keep the third `useSyncExternalStore` argument. It provides the value during
  server rendering, where `localStorage` is unavailable.

## Deliberate Tradeoffs

- `<key>-change` is a same-tab event. Cross-tab sync could listen for the
  browser's `storage` event, but is not part of this feature.

## Known Edges

- `useTimelineBar` still uses the old local-copy pattern and could move to
  `useBoolPref` later.

## Upstream Extraction

- Check conflicts in the `useBoolPref` implementation.

## Verification

- [ ] `bun run test && bunx tsc --noEmit`
- [ ] With the prose view open, toggle Quick switch and Character mentions in
  Settings; both apply without reload.
