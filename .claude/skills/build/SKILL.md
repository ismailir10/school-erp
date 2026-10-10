---
name: build
description: Second stage of spec → build → verify-local → ship. Executes the approved work record one task at a time — plan the fan-out, implement a slice, test it, gate, two-axis review, simplify, update the record, commit — then runs verify-local until the work meets the proud bar. Use after the spec is approved.
---

<!-- Vendored from agent-workflow@0775c1f by scripts/sync-agent-workflow.sh. Do not edit here: change it upstream and re-sync. Repo specifics belong in AGENTS.md § Repo profile and docs/workflow/. -->

# Build

Input: an approved work record. Output: a clean branch, one commit per task, that has passed `verify-local`.
Nothing pushed (that is `ship`).

Read `working-principles` first if you have not this session. Then read `docs/workflow/build.md` if it exists: its
sections extend the matching steps below.

## 1. Preflight

1. The record is approved and has unchecked tasks. If not → `spec`.
2. You are in the work's own worktree and branch, the tree is clean, and the branch is at most 5 commits behind the
   freshly fetched base (otherwise rebase first).
3. The repo profile's **Setup** has run (deps installed, local database migrated and seeded).

## 2. Plan the fan-out

Classify the tasks: independent (no shared files, no ordering) → parallel workers, one each; sequential → still one
worker per slice, the driver sequences and reviews. Do a task inline only when a worker would need the whole plan as
context or the fan-out costs more than it saves, and say why.

Record the plan before starting, as the first Implementation bullet (cycle doc) or a comment on the issue:
`- Plan: T[..] parallel, T[..] sequential, T[..] inline (why).` Add the driver and worker tiers if the repo profile asks for them.

## 3. For each task

1. **Load context.** Only the files the task needs, plus every rule file the profile's **Load on demand** table maps
   to those files. Load the union of matches and re-check per task.
2. **Check docs** for any library or framework API you are not sure of, before writing against it.
3. **Implement** one vertical slice. No drive-by refactors.
4. **Test it** at the seams the record names: one failing test → minimal code → green, then refactor. For UI with no
   automated seam, drive the real page in a browser and look at a screenshot.
5. **Task gate** (profile → **Task gate**). Red → find the root cause, fix, re-run. Never move on red.
6. **Review on two axes, in parallel** (two reviewer workers on the task's diff, reports kept separate):
   - **Standards** — `working-principles`, the repo's rules for the files touched, and baseline smells (duplication,
     dead code, long functions, leaky abstractions, needless complexity). Repo rules win over the baseline.
   - **Spec** — the diff against the record: missing acceptance criteria, scope creep, contradicted decisions. Each
     finding quotes the record line.
   Add a **security** reviewer when the diff touches the profile's **Sensitive paths**. Fix real findings, re-run the
   gate, re-review. Note low-confidence nits; they don't block.
7. **Simplify** the diff without changing behavior: remove accidental complexity, collapse duplication, reuse helpers.
8. **Update the record:** tick the task; add `- T<n>: <files> — <summary>` to Implementation (cycle doc) or the PR
   notes you are collecting (issue).
9. **Commit** one commit for the task, in the profile's commit style, referencing the record.

## 4. After the last task

1. Run **`verify-local`** in full. This is not optional and not deferrable to CI. Iterate until it passes the proud bar
   or hits its stop rule.
2. If a user-facing capability, route, env var or setup step changed, update the docs the profile names in the same
   branch.
3. Fill **Ship Notes**: migrations, env vars, manual steps, post-merge checks, rollback path. Commit.
4. Continue straight into `ship`, carrying forward: record, branch, commits, the verify-local evidence block, and every
   judgment call made (for **Decisions made**).

## Rules

- One commit per task; gates pass between tasks; no "fix it in the next task".
- If the spec turns out wrong, stop and say so. Don't silently re-scope.
- A new dependency, unplanned migration or auth/PII change re-opens the gate.
