# Forked Features

Features this fork maintains but upstream doesn't have (yet). Each feature
gets one file in this folder. This README is the index, the rules, and the
entry template.

The workflow keeps multiple independently owned features on one integration
branch, allows each to evolve through interleaved commits, and uses commit
trailers to select a feature's complete history for a possible upstream PR.
Feature docs provide the human context needed to review, maintain, and extract
those commits safely.

| Feature | Added | Status | Doc |
|---|---|---|---|
| Conversation Index Lock | 2026-08-22 | stable | [fix-conversation-index-lock.md](./fix-conversation-index-lock.md) |
| POV Voice | 2026-08-22 | stable | [pov-voice.md](./pov-voice.md) |
| Bool Pref Sync | 2026-08-23 | stable | [fix-bool-pref-sync.md](./fix-bool-pref-sync.md) |
| Seamless Edit | 2026-08-23 | stable | [seamless-edit.md](./seamless-edit.md) |

## Adding a feature

Work happens on the `fork-features` branch.

1. Create `<slug>.md` from the template below, add a row to the table, and
   commit those documentation changes as fork maintenance without a trailer.
   Maintenance subjects start with `docs(fork):` or `chore(fork):` so the
   validator can distinguish them from feature commits.
2. Commit the feature following Rules 1-2. Multiple commits and interleaved
   features are fine. End every feature commit message with its ownership
   trailer:
   ```text
   Fork-Feature: <slug>
   ```
   For example:
   ```sh
   git commit -m "feat(prose): improve inline editing" \
     --trailer "Fork-Feature: seamless-edit"
   ```
3. Verify the selector. This must list exactly the feature's commits, oldest
   first:
   ```sh
   git log upstream/master..fork-features --no-merges --reverse --format='%H %s' \
     --grep='^Fork-Feature: <slug>$'
   bun run fork:validate
   ```
4. Run the feature's Verification checklist, then push the branch:
   ```sh
   git push origin fork-features
   ```

## Retrofitting unpublished commits

Rewriting is simplest before commits are shared. If you control the remote or
have coordinated with every branch user, publish a rewrite with
`git push --force-with-lease origin fork-features`, never plain `--force`. A
dirty integration worktree does not need to be stashed: build the replacement
history in a detached temporary worktree based on `upstream/master`, replay
fork maintenance first, then replay each feature commit with its trailer.

Before repointing `fork-features`, run the validator against the temporary
`HEAD` and verify that the replacement tip has the intended tree. Update the
branch ref with its old tip as the expected value, then remove the temporary
worktree. If the replacement and current tips have the same tree, the checked
out worktree remains unchanged, including unrelated untracked files.

```sh
git worktree add --detach /tmp/errata-fork-rewrite upstream/master
# In the temporary worktree: replay maintenance and feature commits.
bun run fork:validate upstream/master..HEAD
# Back in the integration worktree after recording the replacement HEAD:
git diff --exit-code <old-tip> <new-tip>
git update-ref refs/heads/fork-features <new-tip> <old-tip>
git worktree remove /tmp/errata-fork-rewrite
```

Review local tags after rewriting. A tag that points to an old feature commit
keeps the replaced history reachable and may no longer identify the feature's
current tip.

Verification can fail for pre-existing reasons (known flaky test, baseline
`tsc` errors; see AGENTS.md), not the rewrite. Compare against the old tip:

```sh
git worktree add --detach /tmp/errata-baseline <old-tip>
ln -s "$PWD/node_modules" /tmp/errata-baseline/node_modules
# Re-run the failing command here; only new failures come from the rewrite.
git worktree remove /tmp/errata-baseline
```

## Rules

1. **Every feature commit has one owner.** Never mix two features into a
   single commit. Every feature commit has exactly one
   `Fork-Feature: <slug>` trailer; upstream merges and fork-maintenance commits
   have none.
2. **Keep the path list accurate.** Record every path the feature adds or
   changes. The list and counts are human review and conflict aids; the
   validator does not derive or enforce them. Extraction selects whole commits,
   not paths.
3. **Use a stable slug.** A feature keeps the same trailer value for its whole
   lifetime. Rebase and cherry-pick preserve commit messages, so rewritten
   hashes do not affect selection. After squash/fixup, verify the resulting
   commit still has exactly one trailer.
4. **Record dependencies and shared files.** Shared paths are safe because
   extraction selects whole commits rather than filtering by path. Record a
   semantic dependency only in the dependent feature's `Dependencies` field;
   do not mirror it in the dependency's doc. Split any mixed commit before
   extraction.
5. **Keep reversals with their feature.** A revert or follow-up fix uses the
   same trailer as the feature it changes.
6. **Sync from upstream regularly.** Prefer merging upstream into the shared
   integration branch; rebasing is metadata-safe but rewrites the branch and
   requires coordination and a force-push. The local `git sync` alias fetches
   upstream, fast-forwards the local `master` mirror, merges it into
   `fork-features` when the worktree is clean, and pushes `origin/master`:
   ```sh
   git switch fork-features
   git sync
   bun run fork:validate
   git push origin fork-features
   ```
   After each sync, run affected features' Verification checklists.

## Extracting a feature (PR back to upstream)

List the feature commits and copy the hashes in the displayed oldest-first
order:

```sh
git fetch upstream
git log upstream/master..fork-features --no-merges --reverse --format='%H %s' \
  --grep='^Fork-Feature: <slug>$'
```

If the feature has dependencies, choose one strategy before replaying it:

- **Merged dependency:** extract and merge each dependency upstream first,
  then fetch the updated `upstream/master` and use the standard commands below.
- **Stacked PR:** extract the dependency to its own branch, create the dependent
  feature branch from that branch, and target the dependency branch until its PR
  merges. Then retarget or rebase the dependent PR onto `upstream/master`.
- **Bundled PR:** create the branch from `upstream/master`, then cherry-pick the
  complete transitive dependency set in dependency order before the feature's
  own commits. The resulting PR intentionally includes all of them.

For a feature with no dependencies, or whose dependencies are already merged,
create a fresh upstream branch and replay its exact commits in chronological
order:

```sh
git switch -c feat/<slug> upstream/master
git cherry-pick -x <oldest-hash> <next-hash> ...
```

- Whole-commit selection preserves discrete history and cannot pull in another
  feature merely because it touches the same file.
- Resolve conflicts using the feature's Contracts and conflict hotspots, then
  run its Verification checklist against the extracted branch.
- Missing ownership metadata or irreparably messy history? As a last resort,
  make a squashed patch from the current feature paths:

  ```sh
  git diff upstream/master...fork-features -- <paths> > /tmp/<slug>.patch
  git switch -c feat/<slug> upstream/master && git apply --3way /tmp/<slug>.patch
  ```

  Inspect it carefully: path-based fallback can include other features that
  share those files and does not preserve commits.

Then open the PR against tealios/errata. Leave `docs/_fork_features/` out of
it and follow any feature-specific upstream notes in its doc.

## Entry template

Keep entries concise, but record decisions that cannot be recovered safely
from the code alone. In particular, retain deliberate tradeoffs, accepted
edges, invariants, extraction notes, and focused verification steps.

```md
# <Feature name>

**Added:** YYYY-MM-DD · **Status:** wip|stable · **Upstreamable:** yes|maybe|no
**Commit trailer:** `Fork-Feature: <slug>`
**Dependencies:** none

One or two sentences: what it does and why it's forked.

## Paths

List every file and give a short explanation of its role in the feature.

New (<count>):
- `path`: what it adds

Modified (<count>):
- `path`: what changed

Shared:

- none, or: `<path>` with `<other-slug>`

## Contracts

- Invariants that must not break silently.

## Deliberate Tradeoffs

- Intentional duplication or other choices a maintainer may otherwise undo.

## Known Edges

- Accepted limitations that should not be mistaken for regressions.

## Upstream Extraction

- Dependency order, defaults to change, and conflict hotspots.

## Verification

- [ ] commands
- [ ] focused manual checks
```
