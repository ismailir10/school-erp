---
name: working-principles
description: The shared operating principles for every coding agent in a repo that uses agent-workflow. Read at the start of any session that will change code, and whenever spec, build, verify-local or ship tells you to. Covers who drives the loop, the one human gate, when to stop and ask, driver/worker split, evidence rules and the local "proud" bar.
---

<!-- Vendored from agent-workflow@0775c1f by scripts/sync-agent-workflow.sh. Do not edit here: change it upstream and re-sync. Repo specifics belong in AGENTS.md § Repo profile and docs/workflow/. -->

# Working principles

These rules are shared across every repo that vendors agent-workflow. Repo-specific facts (commands, branches,
URLs, domain rules) live in the repo's `AGENTS.md` § **Repo profile** and in `docs/workflow/*.md`. When the two
disagree, the repo wins for facts and commands; these principles win for how you work.

## 1. You drive the loop

The user says what they want. You classify it and run the loop yourself; they never need to type a command.

| Request | Route |
|---|---|
| Feature, bug fix, behavior change, schema, CI or build config | `spec` → user approves → `build` → `verify-local` → `ship` (chained, no further prompt) |
| Docs/skills only, or a trivial fix (typo, copy, comment) | branch from the base → task gate → `ship`. No spec unless it is more than a fix |
| Existing PR the user already authorized (review, fix, merge) | continue in that branch; no new spec unless scope changes |
| Question, code read, investigation, DB or ops lookup | answer inline; no branch, no PR |

The slash commands still exist so the user can re-enter a phase by hand.

## 2. One human gate

**Spec approval is the only gate.** Approving a spec authorizes that work's branch, PR and (where the repo profile
allows it) its self-merge to the base branch, and nothing beyond it.

Re-open the gate when the work changes shape underneath you: a new dependency, a schema migration the spec did not
name, an auth/permission/PII behavior the spec did not state, a production write, or anything the spec called a
non-goal. Say what changed and ask.

## 3. Stop and ask only for

1. directional product decisions (during `spec`);
2. scope drift from the approved spec;
3. destructive or irreversible operations: DROP/rename migrations, data deletion, deleting remote branches,
   changing secrets or cloud resources;
4. auth, permission or PII behavior changes the spec does not state;
5. three fix rounds without progress (in `verify-local` or `ship`);
6. missing infrastructure or credentials, including "I cannot run the app locally";
7. production promotion. It is only ever user-initiated, and the repo profile says who merges it.

Decide everything else yourself and log it under **Decisions made** in the PR.

## 4. Facts are yours, decisions are the user's

Anything answerable from code, docs, git history, CI or the issue tracker: look it up, never ask. Ask the user only
for decisions (behavior, scope, trade-offs, naming), in numbered rounds, each with your recommended answer and one
line of why.

## 5. Isolation

- One piece of work = one branch in its own worktree, cut from a freshly fetched base branch.
- Never inherit a dirty tree. If you find one, ask whether to commit, stash or abort.
- More than 5 commits behind the base → rebase before building, and re-run the task gate after.

## 6. Driver and workers

The main session is the **driver**: it holds the spec, the decisions and the status, and it decomposes, reviews and
decides. **Workers** (subagents, on a cheaper tier when the harness allows) do exploration, sweeps, mechanical edits,
fixtures and single pre-specced slices. Independent tasks run in parallel, one worker each.

Brief every worker with: the spec text, its one task, the files and patterns to reuse, and its done condition. The
driver reads the workers' distilled output, not the raw files. Skip fan-out only when it costs more than it saves
(one or two trivial tasks) and say so in the plan.

## 7. Evidence over assertion

- Never record a result you did not just see. Paste the real tail of the output, not a memory or a prediction.
- Re-run anything a worker says passed before you record it. Workers have reported failures that did not exist and
  passes that did not happen.
- "No checks reported" is not green. A skipped test is not a pass.

## 8. Local first, CI second

Verify on your machine against the real app. CI is the backstop, not the test: CI minutes are metered and the heavy
e2e jobs only run on demand. "CI will catch it" is never a reason to skip a local check. If you cannot run something
locally, that is stop-and-ask #6, not a silent deferral.

## 9. The proud bar

Work is done when you would demo it to the user right now, with no caveats. In practice that means `verify-local`
passed: you ran the app, walked every acceptance criterion as the user would, looked at it, the full gate is green,
the diff is the simplest thing that works, and the evidence is recorded. Green gates alone are not done. Work that
touches UI also carries 1–2 highlight screenshots in its PR, so the user sees the result without running anything.

## 10. Engineering discipline

- **Scope:** touch only what the task needs. Note unrelated bugs or ideas in your report; don't fix them in passing.
- **Docs before APIs:** check current library/framework docs (Context7 or the official docs) before writing against an
  API you are not sure of. Never guess an API shape.
- **Root cause:** read the error, find the cause, fix it. No blind retries, no weakening or skipping a test to get
  green, never `--no-verify`, never amend a pushed commit.
- **Tests at the seams:** test-first for behavior changes at the agreed seams; mock only at system boundaries; don't
  write tests that recompute the expected value the way the code does.
- **Reuse before you create:** find the existing helper, component or pattern first.

## 11. One source of truth per fact

- The work record (issue or cycle doc, per the repo profile) is the only planning artifact. No `PLAN.md`, `NOTES.md`
  or scratch markdown.
- Never hand-write a fact the code owns (counts, env var lists, versions). Link to where it lives.
- Shared rules change upstream in agent-workflow, never in the vendored copy.

## 12. Commits and reporting

- One task = one commit. Subject says what changed; body says why and references the work record. Follow the
  repo profile's commit style and attribution policy exactly (some repos forbid AI attribution, some require it).
- When the loop finishes, send **one** status message: work record, PR, verified SHA, evidence summary, merged SHA,
  post-merge health.
