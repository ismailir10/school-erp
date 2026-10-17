# Vendored skills

Skills (and helper scripts) in this repo that come from an upstream repo, checked in rather than
installed per-harness. Reason: `CLAUDE.md` § Parallel harmony requires **one
canonical skill set** — a `/plugin install` or `npx skills add` is harness-local
and would give Claude, Codex, and opencode three different copies (or none).

**Never hand-edit a vendored skill.** Fix it upstream, or re-vendor and record
the new sha below. Local deviations belong in `.claude/standards/*` instead,
which take precedence over vendored guidance on conflict.

## `interfaces` — `better-*` (7 skills)

| | |
|---|---|
| Upstream | https://github.com/jakubkrehel/skills |
| Homepage | https://interfaces.dev/ |
| License | MIT — © 2026 Jakub Krehel |
| Vendored sha | `a67333399dabbc71d7778962cb9c4fb9b86a00d0` (2026-07-29) |
| Vendored on | 2026-07-30 |
| Paths | `better-accessibility/`, `better-colors/`, `better-interface/`, `better-layout/`, `better-typography/`, `better-ui/`, `better-writing/` |

Six domain skills auto-trigger from their `description` frontmatter;
`better-interface` is the user-invoked orchestrator (`/better-interface [quick|full] <area>`).
Each skill dir also carries an `agents/openai.yaml` — upstream's Codex/OpenAI
manifest, kept so a re-vendor is a clean directory replace.

Precedence, dispatch table, and the `/build` load rule live in **CLAUDE.md
§ Standards → Interface-craft skills**. Codex symlinks are created by
`scripts/link-agent-skills.sh`.

### Re-vendor

```bash
git clone --depth 1 https://github.com/jakubkrehel/skills.git /tmp/jk-skills
rm -rf .claude/skills/better-*
cp -R /tmp/jk-skills/skills/better-* .claude/skills/
git -C /tmp/jk-skills rev-parse HEAD   # update the sha above
bash scripts/link-agent-skills.sh
```

Diff the result before committing — an upstream rename or a new `better-*` skill
needs the CLAUDE.md dispatch table and `link-agent-skills.sh` updated too.

## `agent-workflow` — the loop (5 skills, 2 scripts)

| | |
|---|---|
| Upstream | https://github.com/ismailir10/agent-workflow (private) |
| License | Same owner as this repo |
| Pinned ref | `ref=` in `.claude/skills/.agent-workflow.lock` (written by the sync script, never by hand) |
| Paths | `working-principles/`, `spec/`, `build/`, `verify-local/`, `ship/`, plus `scripts/sync-agent-workflow.sh` and `scripts/pr-screenshots.sh` |

The shared `spec → build → verify-local → ship` procedure. Talib's own steps live in `docs/workflow/*.md` and its
facts in CLAUDE.md § Repo profile; neither is touched by a sync. The `Checks` check runs
`bash scripts/sync-agent-workflow.sh --check`, which fails on any hand edit to a file listed in the lock.

### Re-vendor

```bash
bash scripts/sync-agent-workflow.sh            # latest upstream main; --ref <sha|tag> to pin
bash scripts/link-agent-skills.sh
```

Review the diff before committing. A skill upstream adds or drops needs `link-agent-skills.sh` updated too.
