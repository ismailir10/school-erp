# Spec — Talib extensions

Extends the shared `spec` skill (`.claude/skills/spec/SKILL.md`). Facts (branches, commands) live in
[CLAUDE.md § Repo profile](../../CLAUDE.md#repo-profile).

## Preflight

Run before the shared preflight. The user never runs any of this by hand, and setup needs no confirmation.

1. **Session role.** Rewrite `.claude/session-role` with `role=cto` and **your own** model ID, even if the file looks
   fresh. `prepare-commit-msg` copies it into every commit, so a stale value mis-attributes the work.
2. **Worktree.** If `git rev-parse --git-dir` equals `git rev-parse --git-common-dir` you are in the main checkout:
   derive a 2–4 word kebab-case slug, run `bash scripts/setup-worktree.sh <slug>` (branches `feat/<slug>` from
   `origin/staging`, symlinks `.env`/`.env.local`/`node_modules`, installs hooks), `EnterWorktree` into
   `.worktrees/<slug>`, and rewrite `.claude/session-role` inside it.
3. **Hooks.** `.githooks/.installed` must exist; if not, run `bash scripts/install-hooks.sh`.
4. **Branch.** On `staging` or `main` with a dirty tree → stop (`git stash -m '<description>'` first). On any branch
   other than `feat/*` → ask whether to continue or switch.
5. **UAT reports.** Read the newest `docs/uat/reports/*.md` whose area overlaps the request. If it is older than 60
   days, or older than the newest cycle doc touching the same files, mark its findings *"possibly stale — verify
   before acting"* in `## Context`. Otherwise copy its **blocker** and **major** findings into `## Context` as inputs;
   ignore minors. Stage the consumed report with `git add -f` in the cycle-doc commit (reports are gitignored).

## Rules

- The record is one cycle doc, `docs/cycles/YYYY-MM-DD-<slug>.md`: the shared record shape, then empty
  `## Implementation`, `## Verification` and `## Ship Notes`. No sibling markdown (`pre-commit` rejects it).
- Claude Code: refine a vague request with `superpowers:brainstorming` and write `## Tasks` with
  `superpowers:writing-plans`, redirected into the cycle doc (CLAUDE.md § One-File-Per-Cycle Rule).
