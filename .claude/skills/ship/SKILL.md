---
name: ship
description: Final stage of spec → build → verify-local → ship. Checks the local evidence, pushes, opens the PR with summary, evidence, decisions and merge danger, watches CI, runs the fix loop, merges per the repo profile and confirms post-merge health. Production promotion only when the user asks.
---

<!-- Vendored from agent-workflow@0775c1f by scripts/sync-agent-workflow.sh. Do not edit here: change it upstream and re-sync. Repo specifics belong in AGENTS.md § Repo profile and docs/workflow/. -->

# Ship

Input: a branch that passed `verify-local`. Output: merged to the base branch per the repo profile, post-merge health
confirmed, branch and worktree cleaned up, one status message sent.

Read `working-principles` first if you have not this session. Then read `docs/workflow/ship.md` if it exists: its
sections extend the matching steps below (deploy checks, extra PR sections, promotion steps).

## 1. Preflight (stop on any failure)

1. Tree clean; branch is neither the base nor the production branch; every task ticked.
2. **Evidence:** a `Verified locally — <sha>` block exists for the current head (or for the last commit that touched
   runtime files, with only docs after it), and for a UI change it names 1–2 highlight shots. Missing or stale → run
   `verify-local` now.
3. Docs the profile names are updated if routes, modules, env vars or setup changed.
4. Behind the base → rebase, re-run the task gate, and re-run `verify-local` if the rebase brought in runtime changes.

## 2. Push and open the PR

`git push -u origin HEAD` (retry network failures with backoff). Open the PR to the profile's **Base branch**
(draft or ready per profile), with this body plus any sections `docs/workflow/ship.md` adds:

```markdown
## Summary
What changed and why, plus the smallest useful visual (before/after, call tree, or diagram).

## Screenshots
1–2 highlight shots from verify-local, each with a one-line caption. Only for PRs that touch UI.

## Verified locally
<the evidence block from verify-local, with screenshots attached>

## Decisions made
Judgment calls taken without asking, one line each.

## Merge danger
Rollback path · blast radius · migrations (additive?) · env/secret/config changes.

## Ship notes
Migrations, env vars, manual steps, post-merge checks.

<link to the work record, e.g. "Closes #123" or "Cycle: docs/cycles/<file>.md">
```

Follow the profile's attribution policy for the PR body exactly.

**Screenshots are required when the PR touches UI** (any page, component, style, copy or layout a user sees). Upload
the highlight shots once the PR number exists and put the printed markdown in the **Screenshots** section:

```bash
bash scripts/pr-screenshots.sh <pr> <highlight-1.png> [highlight-2.png]
```

It stores them on the never-merged `pr-assets` branch and prints image links pinned to that commit. Open the PR page
and check they render; if they do not, say so in the report rather than shipping without them. After a fix round
that changes what the user sees, retake and re-upload, and replace the links. A PR with no UI change says
`n/a — no UI change` in the section.

If the profile's **CI** row says heavy jobs are label-gated (e.g. an `e2e` label) and this PR touches what they cover,
add the label.

## 3. Watch CI

Wait for every check on the head commit. "No checks reported" is not done. Red → reproduce locally, fix the root
cause, push. No empty commits, no skipped tests, no re-running a red job hoping it passes, unless you have shown the
failure is a known flake unrelated to the diff (say so in the PR).

## 4. Fix loop

Any fix after the PR is open: smallest change → task gate → commit → push → re-run `verify-local` if runtime files
changed → update the PR's evidence. After 3 rounds without progress, label the PR `needs-human`, post the findings,
and stop.

## 5. Merge

Per the profile's **Merge** row:

- **Self-merge allowed:** when CI is green and the evidence is for the head SHA, merge with the profile's method,
  pinned to the verified commit (`gh pr merge <pr> --<method> --delete-branch --match-head-commit <sha>`).
- **Human merges:** say it is ready, with the evidence summary, and stop.

Then confirm the work record closed (close the issue with the PR and merge SHA if it did not), remove the worktree,
make sure the branch is gone remotely and locally.

## 6. Post-merge

Run the profile's **Post-merge** checks (deploy finished, health endpoint, signed-in check where the repo requires
one). A failure here is reported immediately, with the merged SHA.

## 7. Report

One message: record, PR, verified SHA, evidence summary, merged SHA, post-merge health. End of the loop.

## Promotion to production

Only when the user explicitly asks; never self-invoked. Follow `docs/workflow/ship.md` § Promotion: typically a PR
from the base branch to the production branch listing the merged PRs and migrations since the last release, merged
by whoever the profile says, with a **merge commit** (a squash breaks the branch ancestry).
