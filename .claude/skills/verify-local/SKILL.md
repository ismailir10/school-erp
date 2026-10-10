---
name: verify-local
description: The local "proud" loop. Run the real app on this machine, pass the full gate, walk every acceptance criterion and verify flow as the user would, look at the result critically, fix and repeat until you would demo it with no caveats — then record the evidence. Called at the end of build and re-run by ship after any fix. Use whenever you are about to call work done.
---

<!-- Vendored from agent-workflow@0775c1f by scripts/sync-agent-workflow.sh. Do not edit here: change it upstream and re-sync. Repo specifics belong in AGENTS.md § Repo profile and docs/workflow/. -->

# Verify local

Done is not "the gates are green". Done is: **I ran it, I used it as the user would, I looked at it, and I would
demo it to the user right now with no caveats.** This skill is how you get there and how you prove it.

Read `docs/workflow/verify.md` if it exists: it names how this repo starts the app, signs in, seeds data and what its
UI bar is. Its sections extend the matching steps below.

## 0. Scope

- **Docs-only diff** (every changed file is documentation): skip steps 1–4. Record the changed paths and the compared
  SHA in the evidence block. A package, lock, config, CI, schema, migration, generated or runtime file disqualifies
  the skip.
- **Cannot run the app or the e2e suite locally** (missing infra, credentials, browser): stop and ask the user.
  Never defer silently to CI. CI's e2e may not run on the PR at all.

## 1. Full gate

Run the profile's **Full gate**, including e2e for any diff that touches a user flow. Red → root cause, fix, re-run.

## 2. Run the real app

Start it the way the profile says (**Run locally**). Prefer a production build for the final round. Wait for the
health check, sign in the way the profile says (test accounts, demo mode or pairing flow — never production data,
never a real user's credentials).

## 3. Walk it as the user

For every acceptance criterion and every verify flow in the record:

1. Act as the role the flow names, in a real browser (whichever browser tool this harness has).
2. Walk the main path, then the edge case and the error case.
3. After each step, check the console and network: no errors, no 4xx/5xx you did not expect.
4. For UI, screenshot the key states at desktop (1440×900) and phone (390×844) width.
5. For UI, also take the **highlight shots** for the PR: 1–2 screenshots that show the work at a glance to someone who
   has not read the diff. The changed area is front and centre (crop or scroll to it; an element screenshot is fine),
   in a realistic state with dummy data, at desktop width unless the work is phone-first. A second shot only when it
   adds something: before/after, the phone layout, or a second key state. Save them as
   `<short-description>.png` (the file name becomes the caption). Retake them in the last round so they match the
   head commit.

## 4. Critique it

Look at what you captured and write the findings down. Ask:

- Does each acceptance criterion visibly hold? Would the user agree from the screenshot alone?
- Don't make me think: is the primary action obvious, are labels self-explanatory, do empty/loading/error states say
  what to do next, does every clickable thing respond?
- Does it follow the repo's UI rules (profile → **Load on demand**)? Anything clipped, overlapping, misaligned, or
  scrolling sideways on a phone?
- Is the copy right (language, tone, no placeholder text)? Is it fast enough to not notice?
- Is the diff the simplest thing that works: no dead code, no TODOs, no debug output?
- **Would I demo this right now, with no caveats?**

Classify each finding:

- **Blocker:** failed criterion, console error, 5xx, dead click, broken form or navigation, blank/clipped/overlapping
  UI, wrong data.
- **Polish:** anything that makes you hesitate to demo it.
- **Out of scope:** real but not this work → note it for the report, don't fix it here.

## 5. Fix and repeat

Fix blockers and polish in scope (smallest change, task gate, commit), then go back to step 1. Each pass is a
**round**. Stop when a round finds nothing you would fix.

**Stop rule:** after 3 rounds without progress (the same blocker, or new ones as fast as you fix them), stop and
report to the user with the findings and what you tried. Never ship around a blocker.

## 6. Record the evidence

Write this block into the cycle doc's `## Verification` (or keep it for the PR body when the record is an issue).
Every line must be something you just saw.

```markdown
### Verified locally — <short SHA>, <date>
- Gate: `<full gate command>` → <real tail, e.g. "Tests 466 passed (466)">
- App: <how it ran, e.g. "production build on http://localhost:3000, demo admin">
- Walked: <each flow → result>, incl. edge: <…>, error: <…>
- Console/network: clean | <what was seen and why it is fine>
- Screenshots: <paths> (desktop + phone)
- Highlight: <1–2 paths> | n/a (no UI change)
- Rounds: <n> — fixed: <one line per fix>
- Not checked: <anything you could not check, and why> | none
```

`ship` refuses to open or merge a PR whose evidence block is missing, or was recorded for a different SHA than the
head (re-run from step 1 after any new commit that touches runtime files).
