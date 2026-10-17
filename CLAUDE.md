# Talib (engineering id: `school-erp`) — Operating Manual

> Operating manual for AI development sessions. This file is the *how*; [README.md](./README.md) is the *what*. `AGENTS.md` is a **symlink to this file** — Codex and opencode read it, so one edit reaches every harness. Never edit `AGENTS.md` directly.
>
> **Rule of thumb for editing this file:** never hand-write a fact the code owns. Counts live in one generated block (bottom); `bash scripts/audit-docs.sh` fails CI if any doc drifts.

---

## The Loop

One cycle = `spec → build → verify-local → ship`, and exactly **one** markdown file, `docs/cycles/YYYY-MM-DD-<slug>.md`.

The procedure is the shared [agent-workflow](https://github.com/ismailir10/agent-workflow) skills, vendored into
`.claude/skills/` by `scripts/sync-agent-workflow.sh` (pinned in `.claude/skills/.agent-workflow.lock`): start with
[`working-principles`](.claude/skills/working-principles/SKILL.md), then [`spec`](.claude/skills/spec/SKILL.md),
[`build`](.claude/skills/build/SKILL.md), [`verify-local`](.claude/skills/verify-local/SKILL.md) and
[`ship`](.claude/skills/ship/SKILL.md). **Never edit them here** — change them upstream and re-sync
(`bash scripts/sync-agent-workflow.sh`); the `Docs sync` check fails on a hand edit. Talib's own steps live in
[`docs/workflow/`](docs/workflow/) ([spec](docs/workflow/spec.md), [build](docs/workflow/build.md),
[verify](docs/workflow/verify.md), [ship](docs/workflow/ship.md)); its facts in the Repo profile below. Below are only
the rules that bind **outside** the skills.

**Non-negotiable ship rules:**
- **No direct pushes to `staging` or `main`, ever.** Use `/ship`.
- Self-merge only when the verification route selected from the actual diff is clean and every required check is green on the head — never on red or pending. App changes use local demo-auth browser verification with disposable local Postgres. Auth-impacting or uncertain changes also get a signed-in check on the **staging deployment** after merge; the PR is labelled `needs-staging-verify` before it merges and keeps it until that check passes, and `/ship --to-main` refuses to promote while any does.
- **Vercel builds only `staging` and `main`.** `vercel.json` `ignoreCommand` → `scripts/vercel-ignore.sh` skips every other branch, so PRs get no preview deployment. This keeps the project inside the free tier; do not re-enable per-PR previews without the user's say-so.
- `/ship --to-main` merges with **`gh pr merge <n> --merge`**. A promotion must be a merge commit — a squash makes staging stop being an ancestor of main and the branches diverge permanently. This has cost us two reconciliations (#381, #465).
- **Playwright runs locally in verify-local** for every diff that touches a user flow, and its result goes in the cycle doc's Verification. CI's `Playwright E2E` only runs on a PR labelled `e2e`, so it is never a substitute: if Playwright cannot run locally, stop and ask. Add the `e2e` label when the PR touches a user flow.

### Orchestration — you drive the loop, not the user

`working-principles` § 1 routes every request. Talib's bindings:

| Request | Action |
|---|---|
| Changes tracked code — `app/`, `lib/`, `components/`, `prisma/`, `scripts/`, `e2e/`, `proxy.ts`, build or CI config | **Run a cycle** |
| Changes tracked workflow docs — `CLAUDE.md`, `.claude/**`, `.githooks/**`, `docs/**`, root project docs | **Use the isolated PR path.** Work in a worktree and ship by PR; a lightweight docs-only cycle doc is enough when the change is more than a one-line maintenance fix. Shared workflow skills change upstream, never here |
| Existing PR review/fix/merge work the user has already authorized | **Continue in that PR/worktree** |
| A question, a code read, a grep, DB/ops work, an untracked personal-doc/config edit such as `~/.claude` | **Answer inline.** No cycle doc, no PR |

Approving the spec authorizes that cycle's PR and its self-merge to `staging`, and nothing beyond it. `/ship --to-main` is **never** self-invoked. The user should never have to think about worktrees, hooks, role files, or which command comes next.

Invoke `/caveman` and `/using-superpowers` by default.

### Testing gates

The gates themselves are in the Repo profile (Task gate, Full gate) and [docs/workflow/verify.md](docs/workflow/verify.md). Repo-specific rules:

- **Keep the e2e suite lean and cross-module** (auth shell, admin dashboard, students, invoices/payment, attendance, teacher daily, parent invoice/report, tenant boundaries). Playwright cold-spin is ~2 min, which is why it runs in verify-local and not between tasks. Prefer Vitest for business logic, permissions and validation.
- E2E runs against a production build (`DEMO_MODE=true npm run start`), Chromium-only, workers: 1. Scope `DEMO_MODE` to the app process; never export it across Vitest.
- **Vitest runs two projects.** `*.test.ts` → `node`, `*.test.tsx` → `jsdom` (a `.ts` suite that renders is named in `DOM_TS_SUITES` in `vitest.config.ts`). 224 of 287 suites never touch the DOM and jsdom construction cost ~2.8s each, which made the runner contend with itself and turned wall-clock ceilings into dice. Config owns the ceilings — `testTimeout` 30s, testing-library `asyncUtilTimeout` 5s — so **never add a per-test or per-suite `{ timeout: … }`**; if one is genuinely needed the global is wrong.
- **A green run proves nothing about flakiness.** `bash scripts/flake-hunt.sh [runs] [cpu-hogs] [paths…]` re-runs the suite under deliberate oversubscription, which is what CI's 4 vCPUs do to three vitest forks. Reach for it whenever a test fails in CI and passes locally.

### Standalone commands

Neither is part of the loop; run on demand.

- **`/uat <area>`** — heuristic UAT. Role-plays a fixed persona through scripted Jobs-to-be-Done via Playwright MCP against strict mobile thresholds (page >4s, API >2s, click-to-visible >3s = blocker), writing `docs/uat/reports/YYYY-MM-DD-<area>.md`. `spec` reads the latest relevant report (60-day staleness rule) into cycle Context. Heuristic, not real UAT — an LLM cannot replicate thumb reach or sunlight glare. Personas: `.claude/personas/`. Skill: [`.claude/skills/uat/SKILL.md`](.claude/skills/uat/SKILL.md).
- **`/audit-docs`** — thin wrapper over `bash scripts/audit-docs.sh`. See [Documentation Maintenance](#documentation-maintenance).

## Repo profile

Shared workflow: the `working-principles`, `spec`, `build`, `verify-local` and `ship` skills in `.claude/skills/`,
vendored from agent-workflow (see `.claude/skills/.agent-workflow.lock`). Never edit them here.
Repo-specific extensions: `docs/workflow/{spec,build,verify,ship}.md`.

| Key | Value |
|---|---|
| Work record | `docs/cycles/YYYY-MM-DD-<slug>.md`, one per cycle ([One-File-Per-Cycle Rule](#one-file-per-cycle-rule)) |
| Read first | [README.md](README.md) (modules, entities), `docs/adrs/active.md`, `.claude/standards/voice.md` (glossary) and `design-system.html`, the newest matching `docs/uat/reports/` |
| Base branch | `staging` |
| Production branch | `main`, promoted only by `/ship --to-main` on the user's typed instruction: PR `staging` → `main`, merged by the user as a **merge commit** ([docs/workflow/ship.md § Promotion](docs/workflow/ship.md#promotion)) |
| Branch name | `feat/<slug>` |
| Isolation | `.claude/session-role` (`role=cto`, your model ID), then `bash scripts/setup-worktree.sh <slug>` → `.worktrees/<slug>` from `origin/staging`, then `EnterWorktree` ([docs/workflow/spec.md § Preflight](docs/workflow/spec.md#preflight)) |
| Setup | The worktree symlinks `.env`, `.env.local`, `node_modules` and installs hooks. Deps change → remove the `node_modules` symlink, `npm install`, `npx prisma generate`. Local DB: [docs/workflow/verify.md § Run the app](docs/workflow/verify.md#run-the-app) |
| Run locally | `DEMO_MODE=true npm run start` after a `DEMO_MODE=true` build, on a disposable local Postgres → http://localhost:3000, health `curl -fs http://localhost:3000`; stop the server and the container afterwards |
| Sign in locally | Demo auth only: `school-erp-session` cookie set to a seeded user id (`u_super_admin`, `u_school_admin`, `u_teacher`, `u_rightjet`) on localhost; demo login picker under `next dev`. Never on staging or any shared host |
| Task gate | `npm run build && npx vitest run` (no `DEMO_MODE` in the Vitest env) |
| Full gate | lint + Vitest + RLS/API-auth guards + `DEMO_MODE=true` build + `npx playwright test` on the disposable DB ([docs/workflow/verify.md § Full gate](docs/workflow/verify.md#full-gate)) |
| CI | Ready (non-draft) PRs: `Docs sync`, `Lint, Typecheck & Test`, `Build`, `Keepalive & Alert Self-Test`. `Playwright E2E` + `Backup Pipeline Self-Test` (`e2e.yml`) run on pushes to `staging`/`main`, manual dispatch, or a PR labelled **`e2e`** — add it when the PR touches a user flow or the backup pipeline. Drafts get no CI ([docs/workflow/ship.md § CI](docs/workflow/ship.md#ci)) |
| Load on demand | [docs/workflow/build.md § Per task](docs/workflow/build.md#per-task): standards and `better-*` dispatch tables |
| Sensitive paths | `app/api/**`, `lib/auth*`, `lib/supabase/**`, `proxy.ts`, tenant or role logic |
| Docs to keep true | README.md when modules, routes or entities change (`feat`/`perf` + `app/`/`lib/` requires it staged); `docs/uat/jobs/<portal>.md` when a portal capability changes; [`docs/runbooks/environments.md`](docs/runbooks/environments.md) for env vars; the counts block below via `bash scripts/audit-docs.sh --write` |
| Commit style | `<type>(<scope>): <task title>`, one commit per task, body ends `Cycle: docs/cycles/<file>.md`; stage the cycle doc with any `app/`, `components/`, `lib/`, `prisma/` change ([hooks](#multi-llm-safety)) |
| Attribution | `prepare-commit-msg` appends `Model-Trailer:`, `Role:` and `Co-Authored-By:` from `.claude/session-role` — never add them yourself. PRs: title `[<model>] …`, label `model:<model>`, `Role:`/`Model:` lines in the body |
| Merge | Self-merge to `staging`, `gh pr merge <n> --squash --delete-branch --match-head-commit <sha>`, once the verification route is clean and every required check is green on that head. Auth-impacting: label `needs-staging-verify` first |
| Post-merge | Vercel staging deploy `READY` for the merge SHA; auth-impacting → signed-in staging check; `bash scripts/cleanup-merged.sh --yes` ([docs/workflow/ship.md § Post-merge](docs/workflow/ship.md#post-merge)) |

---

## Harness Roster & Model Tiering

Three harnesses work this repo in parallel, each in its own worktree, sharing one manual, one `scripts/` set, one `.githooks/` set, one merge gate. No harness has private rules.

| Harness | Driver (reasoning tier) | Dirty-work tier | Can down-tier? |
|---|---|---|---|
| **Claude** | Opus 5, or Fable 5.1 (`claude-fable-5*`) | Sonnet 5, Haiku 4.5 (trivial) | Yes — `Agent` tool with `model` override |
| **Codex** | gpt-5.5 high reasoning | gpt-5.5 low / minimal | Yes — subagents at lower effort |
| **opencode** | glm-5.2 | glm-5.2 (no cheaper tier) | No |

**There is one role: `cto`.** The `product-builder` role was deleted on 2026-09-17. It was real but stale — across the last 220 non-merge commits it carried 5 (`Role: cto` carried 143), and its last was `26e3c6d9` on **2026-07-12**, two months before the deletion. opencode's `glm-5.2` last shipped the same day. Keeping a second role meant every skill carried an untested branch, which is a bad trade now that the assistant runs cycles unattended. opencode still works this repo — as a `cto` harness, with small cycles, since it cannot down-tier.

> A note on counting, because this manual got it wrong once: **do not** `git log --pretty=%B | grep -c '^Role:'`. Squash-merge commits absorb the bodies of every commit they squash, so their trailers get counted again. Count one trailer per commit, taking the last occurrence in each body. The pre-2026-09-17 version of this paragraph claimed "opencode has never shipped a commit" on the strength of the broken count.

### The expensive-driver rule

**The reasoning-tier driver never does cheap work, and never runs a cycle in a single context.** It decomposes, fans out one subagent per independent unit, then reasons only over the distilled findings.

| Driver does it itself | Driver MUST delegate |
|---|---|
| Architecture / ADR decisions | File reads, grep/glob sweeps, exploration |
| PR review + final sign-off | Per-module audits (one subagent each) |
| Spec synthesis + task decomposition | Mechanical edits, boilerplate, codemods |
| Resolving conflicts between subagent outputs | Test fixtures, doc-staleness scans |
| Anything where being wrong is expensive | Implementing a single pre-specced slice |

*Worked example — "audit UI across every module":* driver lists the modules, spawns one dirty-tier subagent per module in parallel, each returns findings, driver dedups and writes the fix spec. The driver read zero module files. That is the win. `build`'s plan bullet records both tiers ([docs/workflow/build.md § Plan](docs/workflow/build.md#plan)) and `ship` refuses a cycle doc without it. opencode cannot down-tier, so it keeps cycles small and is gated by mandatory CTO review instead.

### Parallel harmony

- **Isolation:** every session gets its own worktree and its own gitignored `.claude/session-role`. No shared mutable state.
- **One canonical skill set:** `.claude/skills/*`. Repo-owned skills (`uat`, `audit-docs`) are edited here; vendored ones never are — the shared workflow skills re-sync with `bash scripts/sync-agent-workflow.sh`, `better-*` per `.claude/skills/VENDORED.md`. `scripts/link-agent-skills.sh` symlinks `.agents/skills/* → .claude/skills/*` so Codex reads the same file. Never hand-edit `.agents/skills/*`.
- **Symlinks point one way only: `.agents/skills/* → .claude/skills/*`.** Never commit a link in the other direction — 35 such links (`nextjs`, `vercel-cli`, `shadcn`, …) were committed in `6c8f892e` and dangled on every clone because `.agents/` is gitignored. Removed 2026-08-20. A skill not vendored into `.claude/skills/` belongs in `~/.claude`, not this repo.
- **CTOs (Claude, Codex)** own architecture, PR review, and `/ship --to-main`. opencode never makes architecture decisions and never self-approves.
- `sync-staging.sh` plus the >5-commits-behind preflight keep parallel branches close to `origin/staging`.

---

## Multi-LLM Safety

Other LLMs may work on this repo. Seven mechanisms:

**1. Supabase MCP defaults to staging.** `.claude/settings.json` pins the MCP server to `udbivhchbizpxoryejgz`. It pointed at production until 2026-08-20, making every unqualified `execute_sql` a prod write — one distracted session from repeating the 2026-07-25 data wipe. Production work is now deliberate: name the prod ref explicitly and say so in the cycle doc. Campus names differ per environment ("Taman Aster" vs "An Nisaa' Sekolahku Taman Aster"), so match campuses by `ILIKE`, never equality.

**2. Auto staging sync.** `scripts/sync-staging.sh` runs at `SessionStart`; fast-forwards the main checkout when it lags `origin/<branch>` (ff only; dirty tree → warn no-op; offline → silent). A `feat/*` branch more than 5 commits behind `origin/staging` is rebased before building (`working-principles` § 5).

**3. Session role.** Every session declares itself on turn one in `.claude/session-role`:

```
role=cto             # the only role
model=claude-opus-5  # or gpt-5.5, glm-5.2, claude-sonnet-5, human — must match the current assistant
```

`scripts/check-role.sh` (both Claude's and Codex's `SessionStart` hook) reads and writes exactly this file — every harness uses it; the legacy `.codex/session-role` is a symlink to it. If missing or stale (>12h) the hook tells the assistant to rewrite it. The workflow does not start until it is set ([docs/workflow/spec.md § Preflight](docs/workflow/spec.md#preflight)). **No env var reads** — `CLAUDE_MODEL` is not reliably exported to subprocesses. **If the user's first message declares a role, rewrite the file immediately** with that role and your own model ID, even if it looks fresh. No "already set" exception.

**4. Worktree isolation.** Every session works in its own worktree; `check-role.sh` tells the assistant to create one when it starts in the main checkout. `setup-worktree.sh <slug>` does `git worktree add .worktrees/<slug> -b feat/<slug> origin/staging`, symlinks `.env`/`.env.local`/`node_modules`, and runs `install-hooks.sh`. Change deps inside a worktree → remove the `node_modules` symlink first, then `npm install`, then `npx prisma generate`. Recovery for `.claude/worktrees/<slug>` (which bypasses setup): `bash scripts/bootstrap-env-symlinks.sh`. Cleanup: `bash scripts/cleanup-merged.sh` (`--report` default, `--yes` to remove).

**5. Git hooks** (`scripts/install-hooks.sh` sets `core.hooksPath=.githooks`):

| Hook | Enforces |
|---|---|
| `pre-commit` | markdown allowlist; doc-sync (code change must stage a cycle doc / README / CLAUDE.md); seed drift; frontend gate (frontend diff needs `design-system` in the cycle doc); ADR cells ≤ 400 chars |
| `prepare-commit-msg` | appends `Model-Trailer:` + `Role:` from `.claude/session-role` |
| `commit-msg` | `^(feat\|perf)` + staged `app/**` or `lib/**` requires README staged (cycle doc alone insufficient) |
| `pre-push` | blocks direct pushes to `staging`/`main` for **all** roles including cto |

`scripts/test-hooks.sh` is the exact rule table and every test scenario — run it.

**6. GitHub branch protection.** Hooks can be bypassed with `--no-verify`; branch protection cannot. The intended rule (`ops/branch-protection.json`): `staging` and `main` require a PR, allow no direct push (including the owner), and require green checks — `Docs sync`, `Lint, Typecheck & Test`, `Build`, plus `Playwright E2E` (which reports skipped on a PR without the `e2e` label; see the Repo profile CI row). **Not enforced right now:** the repo is private on the free plan, so the protection API returns 403 and `staging`/`main` report `protected: false`. Until that changes, `pre-push` and `/ship`'s merge rule are the only boundary. **staging → main cadence:** every 2-4 merged cycles.

**7. Commit attribution.** Every commit carries `Model-Trailer:`, `Role:` and `Co-Authored-By:`, auto-appended by `prepare-commit-msg`. A commit that lands as `Model-Trailer: human` means the hook failed — surface it to the user.

### Dependency cadence

Branch protection also requires an **up-to-date head**, which interacts badly with dependabot: merging one bump re-stales every other open PR, so a queue of *n* needs *n* serial rebase + full-CI rounds. Eleven PRs sat frozen for a week over exactly this. Do not merge them one by one.

- **Minors + patches** — batch them. All versions in one branch, `npm install`, one verify-local pass, PR as `chore(deps)`. Dependabot closes its own as superseded.
- **Majors** — one per cycle, never batched. Read the dependabot PR's CI first: red `Build` means real breakage, not a version string.
- **Cadence** — drain at each `/ship --to-main`, so nothing sits longer than 2-4 cycles.
- Security alerts are separate: `gh api repos/:owner/:repo/dependabot/alerts`.

---

## One-File-Per-Cycle Rule

Allowed markdown: root (`README.md`, `CLAUDE.md`, `AGENTS.md`, `LICENSE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`), `docs/**`, `.github/**`, `.claude/**`, `.githooks/**`. Any other staged `.md` is rejected by `pre-commit`.

**Never create `SPEC.md`, `PLAN.md`, `TEST-REPORT.md`, `NOTES.md`.** Everything goes in the cycle doc: the record shape from the [`spec`](.claude/skills/spec/SKILL.md) skill (`## Context`, `## Decisions`, `## Acceptance criteria`, `## Verify flows`, … `## Tasks`), then `## Implementation` (`build`), `## Verification` (`verify-local` evidence) and `## Ship Notes`. Cycle docs written before 2026-10-10 use the older Context / Spec / Tasks shape; leave them as they are.

The `ship` preflight for this repo is [docs/workflow/ship.md § Preflight](docs/workflow/ship.md#preflight).

**Superpowers output redirect.** `superpowers:brainstorming` and `superpowers:writing-plans` default to writing `docs/superpowers/*`. The project rule overrides that — brainstorming goes to `## Context` + `## Decisions` + `## Acceptance criteria`, writing-plans to `## Tasks`. Per that skill's own priority order, user instructions in CLAUDE.md win. Legacy files live in `docs/archive/superpowers-legacy/`.

---

## Documentation Maintenance

Every fact has exactly one owner; the other docs link.

| Document | Owns |
|---|---|
| **README.md** | **Public front page.** Product identity, stack, module one-liners, portals, setup. Budgeted: ≤ 120 lines, no line > 600 chars, enforced by `audit-docs.sh` |
| **CLAUDE.md** | Repo profile, workflow bindings, roster + tiering, safety, hooks, standards, doc maintenance, file structure |
| `.claude/skills/{working-principles,spec,build,verify-local,ship}/` | The shared loop procedure, vendored from agent-workflow — read-only here |
| `docs/workflow/*.md` | Talib-specific steps that extend each shared skill |
| `.claude/standards/*.md` | Domain rules (UI / patterns / voice / CRUD / portal / API / security / colors) |
| `docs/cycles/*.md` | Per-cycle history, **current + previous month only** |
| `docs/cycles/archive/` | Every cycle doc older than that |
| `docs/adrs/archive.md` | ADRs > 60d or codified into CLAUDE.md / a standard |
| `docs/runbooks/*.md` | Operational procedure — reseed, prod incident, payments, email templates |
| `docs/uat/{jobs,reports}/` | UAT JTBD library and committed reports |
| `docs/archive/` | Retired docs of any shape |

**`docs/` holds exactly those six directories** (`adrs`, `archive`, `cycles`, `runbooks`, `uat`, `workflow`). Anything else is drift: `docs/{findings,plans,proposals,qa,reports,reviews}/` each accumulated one to three files nobody owned and now live under `docs/archive/legacy-doc-dirs/`. A one-off write-up belongs in the cycle doc that produced it, not a new top-level directory. `audit-docs.sh` fails on a stray directory.

**Cycle archive rule.** Keep only the current and previous month at the top level; sweep the rest into `docs/cycles/archive/`. When you move one, fix every inbound reference — README, runbooks, and a surprising number of `lib/`, `app/api/` and `e2e/` comments cite cycle docs by path:

```bash
grep -rlE 'docs/cycles/2026-0X-' README.md docs scripts lib app e2e | grep -v node_modules
```

An archived doc is frozen: fix inbound links, never edit the body.

### How the docs stay true

Three layers, weakest to strongest:

1. **`pre-commit` + the `Docs sync` CI check (presence).** A code change must touch a cycle doc / README / CLAUDE.md. This proves *something* was written, not that it is correct — README and CLAUDE.md can rot while every PR is green. That is exactly how the drift of 2026-08-20 happened.
2. **`commit-msg` (narrow).** `^(feat|perf)` + staged `app/**` or `lib/**` requires README staged. `fix|refactor|chore|docs|test|style|build|ci|release` fall under layer 1 only; `Merge|Revert|fixup!|squash!|amend!` bypass.
3. **`bash scripts/audit-docs.sh` (truth).** Runs inside the required `Docs sync` check, so it gates the merge. Verifies: the generated counts block matches the tree; every standards file and `better-*` skill named here exists; every glob in the [docs/workflow/build.md](docs/workflow/build.md) load-on-demand tables matches tracked files; every plugin-qualified skill name in the skills, CLAUDE.md and `docs/workflow/` is declared in the registry; every relative link in README, CLAUDE and `docs/workflow/` resolves; `docs/` has no stray directory; no tracked path is missing on disk; no `.env*` or `verify-accounts.json` is tracked; README stays inside its size budget. Warns (does not fail) on ADR rows past the 60-day window, since trimming is judgement.

The same check runs `bash scripts/sync-agent-workflow.sh --check`, which fails when a vendored workflow skill was edited by hand.

`bash scripts/audit-docs.sh --write` regenerates the counts block. **Never hand-edit a number inside the generated markers** — the check compares against a fresh generation and fails on any difference.

---

## Standards (loaded on demand by `/build`)

`build` loads the **union** of every standard and `better-*` skill matching the task's files; the globs are in [docs/workflow/build.md § Per task](docs/workflow/build.md#per-task).

| File | Covers | Loaded when |
|---|---|---|
| `design-system.html` | **Canonical visual reference** — brand, colors, type, spacing, components, overlays, portal shells, voice | Any frontend change. Enforced by the frontend gate. |
| `parent-portal-cycle4.html` | Scratch parent-portal snapshot | Reference only, scope-locked, do not extend |
| `ui.md` | Shadcn-FIRST, DataTable + action column, spacing tokens, overlays | `components/**`, `app/*/page.tsx`, `lib/format.ts` |
| `patterns.md` | Page recipes — Admin List/Detail/Form, Portal Dashboard, Workflow Queue, Daily Data Entry | `app/*/page.tsx`, `app/**/client.tsx`, `components/{admin,teacher,parent,portal}/**` |
| `voice.md` | Voice & tone — 3 personas, Islamic courtesy layer, error/empty/success/destructive copy, glossary | Any user-facing copy diff |
| `crud.md` | ERPNext-inspired CRUD (Categories A/B/C), soft-delete, list/detail layouts, edit dialog | `app/admin/**` with a create-or-edit form |
| `portal.md` | Portal nav, Empty State Contract, fetch error contract, Household Overview, WeekGrid, class attendance entry | `app/teacher/**`, `app/parent/**`, `components/{teacher,parent}/**` |
| `api.md` | GET list pagination, mutation shape | `app/api/**`, `lib/validations/**`, `proxy.ts` |
| `security.md` | API route checklist, data-access roles, new-route security | `app/api/**`, `lib/auth*`, `proxy.ts` |
| `colors.md` | Color tokens + brand | `app/globals.css` (the `@theme` block), `bg-status-*` edits, arbitrary `#hex` classNames |

**Frontend gate (pre-commit).** Frontend diffs (`app/**/*.{tsx,css}`, `components/**/*.tsx`) require the staged cycle doc to contain the literal token `design-system`. One Verification bullet satisfies it. Keeps the reference alive against silent drift. The hook also matches `tailwind.config.{ts,js,mjs,cjs}`, which is defensive only — Tailwind v4 is CSS-first here and the theme lives in `app/globals.css`'s `@theme` block, so no such file exists.

### Interface-craft skills (vendored)

The standards above cover **this product**. General interface craft — focus rings, motion easing, OKLCH gamut, text wrapping, hit areas — comes from the vendored [`interfaces`](https://github.com/jakubkrehel/skills) collection (MIT; upstream sha in `.claude/skills/VENDORED.md`), checked in under `.claude/skills/better-*`.

| Skill | Covers | Load on |
|---|---|---|
| `better-ui` | Radius, shadows, borders, optical alignment, icons, motion restraint | `components/**`, any hover/focus/active/loading/empty state or motion diff |
| `better-typography` | Font loading, variable fonts, type scale, heading hierarchy, tabular numerals, `text-wrap`, truncation, iOS input zoom | Any text-styling diff; font config; table/number cells |
| `better-colors` | OKLCH, palettes, contrast, gamut/display-p3, semantic tokens, theming | `app/globals.css` (the `@theme` block) — **paired with `colors.md`** |
| `better-accessibility` | Focus + keyboard, focus traps, ARIA, form errors, screen readers, hit areas, `prefers-reduced-motion` | `components/ui/**`, any Dialog/Sheet/Popover/Menu, every form diff |
| `better-layout` | Grouping, alignment, negative space, reading order, progressive disclosure, breakpoints, safe area | `app/*/page.tsx`, `app/**/client.tsx`, `app/**/layout.tsx` — **paired with `patterns.md`** |
| `better-writing` | Button + link labels, error messages, empty states, placeholders, capitalization | Any user-facing copy diff — **paired with `voice.md`** |
| `better-interface` | Orchestrator only — cross-discipline review. User-invoked. | On demand; not auto-loaded |

**Precedence — the project standard wins.** These are craft *defaults*. On conflict: `.claude/standards/*` + `design-system.html` first, then the `better-*` principle. Shadcn-FIRST beats a hand-rolled component; Talib's brand tokens beat a generated OKLCH palette; `voice.md`'s Indonesian personas beat `better-writing`'s English examples. Reach for a `better-*` rule where the project standard is **silent**, never to contradict it. Do not hand-edit these — re-vendor from upstream.

---

## File Structure

```
app/{admin,teacher,parent}/   portal pages
app/api/                      route handlers, organised by domain
components/ui/                Shadcn components (+ __tests__)
lib/{api,validations,payroll,email}/   business logic, retry, integrations
lib/wilayah/                  vendored kode pos data (cahyadsn/wilayah, MIT) + lookup
lib/payments/                 PaymentGateway port + registry, with xendit/ and doku/ adapters
                              behind it; lib/xendit/* are thin re-export shims kept for
                              import-path compatibility
prisma/                       schema + seed
proxy.ts                      Next.js 16 middleware entry (renamed from middleware.ts)
e2e/                          Playwright specs
docs/{adrs,archive,cycles,runbooks,uat,workflow}/
.claude/{skills,standards,personas}/   repo skills + vendored workflow and better-* skills, standards, personas
.githooks/                    pre-commit, prepare-commit-msg, commit-msg, pre-push
scripts/                      audit-docs, setup-worktree, install-hooks, link-agent-skills,
                              sync-staging, cleanup-merged, check-role, test-hooks, reseed-staging,
                              flake-hunt, verify-{rls-coverage,api-auth,curriculum-readiness},
                              backup-prod, keepalive-probe, alert-issue, check-workflow-gh-repo, vendor-wilayah,
                              sync-agent-workflow + pr-screenshots (vendored from agent-workflow)
```

<!-- generated:counts — regenerate with `bash scripts/audit-docs.sh --write` -->
| Surface | Count |
|---|---|
| `app/api/**/route.ts` | 210 |
| `app/admin` pages | 44 |
| `app/teacher` pages | 14 |
| `app/parent` pages | 8 |
| `components/ui/*.tsx` | 71 |
| `e2e/*.spec.ts` | 41 |
| `.claude/standards/*` | 10 |
| `docs/cycles` active / archived | 104 / 233 |
<!-- /generated:counts -->

Demo-mode auth means E2E and local dev need no live Supabase. Lint: `npm run lint`.
