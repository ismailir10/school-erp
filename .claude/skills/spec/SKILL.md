---
name: spec
description: First stage of spec → build → verify-local → ship. Turns a feature, bug or behavior request into one approved work record (GitHub issue or cycle doc, per the repo profile) by looking up facts yourself and asking the user only for decisions, then stops for approval. Use before any change to product code, schema or CI.
---

<!-- Vendored from agent-workflow@ab828e6 by scripts/sync-agent-workflow.sh. Do not edit here: change it upstream and re-sync. Repo specifics belong in AGENTS.md § Repo profile and docs/workflow/. -->

# Spec

Output: one approved **work record**, in the form the repo profile names (a GitHub issue, or
`docs/cycles/YYYY-MM-DD-<slug>.md`). This stage decides; it writes no product code.

Read `working-principles` first if you have not this session. Then read `docs/workflow/spec.md` if it exists: its
sections extend the matching steps below.

## 1. Preflight

1. Working tree clean (or ask: commit, stash or abort).
2. An unfinished record already exists (open issue in progress, or a cycle doc with unchecked tasks and empty Ship
   Notes)? Ask whether to continue it or start new.
3. Set up isolation as the repo profile says (worktree + branch from a freshly fetched base). The user should never
   have to run setup commands themselves.

## 2. Gather facts yourself

Read the repo's domain glossary, ADRs, UI rules and the smallest relevant slice of code (profile → **Read first**).
Find related or duplicate records, prior work on the same area, and helpers to reuse. Delegate broad sweeps to
workers. Anything answerable from code, docs, git history or the tracker gets looked up, never asked.

## 3. Ask for decisions in rounds

If the request is vague, refine it into a concrete goal first. Then each round:

- asks every decision whose prerequisites are settled (not one at a time, not ones that depend on open answers);
- numbers the questions and gives your **recommended answer** with one line of why;
- uses the harness's question tool where it has one, recommendation first.

Repeat until no open decisions remain. When a domain term settles, add it to the glossary. Write an ADR only when a
decision is hard to reverse, surprising without context, and a real trade-off.

## 4. Write the record

Behavioral and durable: no file paths or code in the user-facing sections, so the record stays true while the code
moves. Use this shape (an issue body, or the top of the cycle doc):

```markdown
## Context
Current behavior, desired outcome, who feels it, why it matters.

## Decisions
Choices made while asking, with the reason for each.

## Acceptance criteria
- [ ] Each independently checkable, observable behavior (not implementation activity).

## Verify flows
2–4 user flows to walk on the local app in verify-local: role, start page, steps, expected result, data needed.
Include one edge case and one error case.

## UX notes
Primary action per screen, labels, empty/error states, what the user sees first. Skip for non-UI work.

## Test seams
Where behavior is tested (as few seams as possible), e.g. "API integration test for POST /x", "e2e: admin creates x".

## Non-goals
Nearby work deliberately excluded.

## Assumptions
Everything you would otherwise resolve silently.

## Gate re-openers
Schema migration, new dependency, auth/PII change, production write, paid API use — or "none".

## Tasks
- [ ] T1 <title> — accept: <one-line check> (deps: …, reuse: …)
```

Tasks are ordered, atomic and independently committable. Mark which can run in parallel. A cycle doc also carries
empty `## Implementation`, `## Verification` and `## Ship Notes` sections for later stages. An issue keeps tasks
in its body and verification evidence in the PR.

Call out security, PII, migration (additive?), i18n and design implications when relevant.

## 5. Present and stop

Show the full record and end with:

> **Assumptions:** 1… 2… → Correct me now. On your go-ahead I build, verify and ship without asking again.

Stop. On explicit approval, publish (`gh issue create` / commit the cycle doc) and continue straight into `build`.
If the user only asked for a spec, stop there.
