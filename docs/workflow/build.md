# Build — Talib extensions

Extends the shared `build` skill (`.claude/skills/build/SKILL.md`). Facts live in
[CLAUDE.md § Repo profile](../../CLAUDE.md#repo-profile).

## Preflight

1. `.claude/session-role` carries `role=cto` and your model ID; if not, rewrite it ([spec.md § Preflight](spec.md#preflight)).
2. You are in a worktree (`git rev-parse --git-dir` ≠ `--git-common-dir`) and `.githooks/.installed` exists. If not,
   stop: the cycle should have been in a worktree since `spec`.
3. The record is the newest `docs/cycles/*.md`; empty Tasks → back to `spec`.

## Plan

The plan bullet names both tiers from [CLAUDE.md § Harness Roster & Model Tiering](../../CLAUDE.md#harness-roster--model-tiering):

`- Plan: driver=<model>, workers=<model>; T[..] parallel, T[..] sequential, T[..] inline (why).`

The reasoning-tier driver never implements a fully specced slice itself. `ship` refuses a cycle doc whose
`## Implementation` does not open with this bullet. Claude Code: fan out with `superpowers:subagent-driven-development`.

## Per task

**Load on demand — standards.** Load the **union** of every row the task's files match, re-checked per task (earlier
tasks' loads do not carry over). A frontend diff also requires the literal token `design-system` in the staged cycle
doc after cross-checking `.claude/standards/design-system.html` (`pre-commit` enforces it).

| Staged file glob | Load |
|---|---|
| `components/**`, `app/*/page.tsx`, `lib/format.ts` | `.claude/standards/ui.md` |
| `app/api/**`, `lib/validations/**`, `proxy.ts` | `.claude/standards/api.md` + `.claude/standards/security.md` |
| `app/admin/**` **and** file contains `<Dialog` / `FormField` / `<Field` / a create-or-edit form pattern | **+** `.claude/standards/crud.md` |
| `app/teacher/**`, `app/parent/**`, `app/**/layout.tsx`, `components/{teacher,parent}/**`, `lib/format.ts` | **+** `.claude/standards/portal.md` |
| `app/globals.css` (the `@theme` block), className edits touching `bg-status-*` / `text-status-*`, or files containing arbitrary-color classNames (`text-[#…]`, `bg-[#…]`, `border-[#…]`) | **+** `.claude/standards/colors.md` |
| `lib/auth*`, `lib/supabase/**`, `proxy.ts` | **+** `.claude/standards/security.md` |

`app/*/page.tsx`, `app/**/client.tsx` and `components/{admin,teacher,parent,portal}/**` also load `patterns.md`;
user-facing copy loads `voice.md` (see [CLAUDE.md § Standards](../../CLAUDE.md#standards-loaded-on-demand-by-build)).

**Load on demand — interface-craft skills** (frontend tasks only, vendored `better-*`):

| Frontend task touches | Also invoke |
|---|---|
| `components/**`, `components/ui/**`, hover/focus/active/loading/empty states, transitions or keyframes | `better-ui` |
| Any text styling — font config, type scale, headings, number/table cells, truncation, `text-wrap` | `better-typography` |
| `app/globals.css` (the `@theme` block), arbitrary-color classNames | `better-colors` (with `colors.md`) |
| `components/ui/**`, any Dialog/Sheet/Popover/Menu/custom widget, any form | `better-accessibility` |
| `app/*/page.tsx`, `app/**/client.tsx`, `app/**/layout.tsx` — page/component structure | `better-layout` (with `patterns.md`) |
| Any user-facing copy | `better-writing` (with `voice.md`) |

`.claude/standards/*` + `design-system.html` win over any `better-*` principle; use a skill only where the standard is
silent. Never edit `.claude/skills/better-*` (see `.claude/skills/VENDORED.md`).

**Claude Code bindings for the shared steps:**

| Shared step | Use |
|---|---|
| Check docs | Context7 MCP |
| Test it | `superpowers:test-driven-development`; UI without a unit seam → Playwright MCP on the real page |
| Task gate red | `superpowers:systematic-debugging` |
| Standards review | `feature-dev:code-reviewer` agent on the staged diff (task title, files, cycle doc path in the prompt) |
| Security review (sensitive paths) | `superpowers:code-reviewer` agent, in parallel with the above; both must clear |
| Recording results | `superpowers:verification-before-completion`: paste real output, re-run what a worker claims passed |

**JTBD library.** A task that adds, removes or materially changes a user-facing admin/teacher/parent capability
updates `docs/uat/jobs/<portal>.md` (entries + "Last audited" date). No hook enforces it; stale jobs make `/uat` stale.

**Commit.** Stage the cycle doc with the code (doc-sync rule). The body ends `Cycle: docs/cycles/<file>.md`. Never
type the `Model-Trailer` / `Role` / `Co-Authored-By` trailers: the hook appends them and duplicates break attribution.

## After the last task

- Ship Notes also name the signed-in flows the staging deployment must pass after merge, for auth-impacting changes
  ([ship.md § Post-merge](ship.md#post-merge)). There are no PR previews.
- Dependency changes follow [CLAUDE.md § Dependency cadence](../../CLAUDE.md#dependency-cadence).
