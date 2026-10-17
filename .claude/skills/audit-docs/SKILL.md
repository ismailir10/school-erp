---
name: audit-docs
description: Doc-staleness sweep. Thin wrapper over scripts/audit-docs.sh, which compares README.md and CLAUDE.md against the actual repo state — generated counts block, standards + skill files, relative links, docs/ directory shape, tracked-path sanity, public-repo hygiene, README size budget, ADR 60-day window. The same script runs inside the required "Checks" CI check, so its verdict is the one that gates merges.
disable-model-invocation: true
---

# /audit-docs — doc-staleness sweep

The checks live in **`scripts/audit-docs.sh`**, not in this file. That is deliberate: this skill used to *be* the checks — 165 lines of prose with shell snippets for a model to run by hand — and it silently did not run. Docs drifted for weeks while every PR passed. The logic now lives in a script that exits non-zero and runs inside the required `Checks` check, so it cannot be skipped.

**Your job here is to run it and interpret the result, not to re-implement it.**

## Run

```bash
bash scripts/audit-docs.sh
```

Exit 0 = clean. Exit 1 = at least one `fail`; the report names each one.

To fix a stale counts block:

```bash
bash scripts/audit-docs.sh --write
```

That regenerates the `<!-- generated:counts -->` block in CLAUDE.md from the tree. Never hand-edit numbers inside those markers — the check compares against a fresh generation and fails on any difference.

## Report

1. Print the script's report verbatim. Do not summarise away a `fail`.
2. If an **active cycle doc** exists (`## Ship Notes` empty and `## Tasks` has unchecked boxes), append the report to its `## Verification` section.
3. Otherwise leave it on stdout.

Never create a new markdown file — the one-file-per-cycle rule applies.

## Interpreting findings

| Finding | What it means | Fix |
|---|---|---|
| Counts block stale | A count in CLAUDE.md no longer matches the tree | `--write`, then commit |
| Standards / skill file missing | CLAUDE.md's dispatch table names a file that does not exist — `/build` would fail to load it | Restore the file or remove the row |
| Relative link broken | A doc points at a moved or deleted path (archive sweeps cause most of these) | Repoint the link; never edit an archived doc's body |
| Stray `docs/` directory | Someone created a new top-level doc dir | Fold it into the cycle doc that produced it, or `docs/archive/` |
| Tracked path missing | A committed symlink or file is not on disk — dangles on every clone | `git rm --cached` it |
| Env / account file tracked | A secret-bearing or account-naming file is committed to a **public** repo | Untrack, gitignore, and rotate anything exposed |
| README over budget | The public front page is absorbing operational detail again | Move it to `docs/runbooks/` or CLAUDE.md |
| ADR past 60 days (`warn`) | A row in `docs/adrs/active.md` aged out | Move it verbatim into `docs/adrs/archive.md` |

## Rules

- **The script is the source of truth.** If a check needs changing, edit `scripts/audit-docs.sh` — do not describe new checks here.
- **Read-only against git.** `--write` touches only the generated block in CLAUDE.md. The skill never commits, pushes, or moves files.
- **Findings name the doc that's wrong.** Source code is canonical; never "fix" code to match a stale doc.
