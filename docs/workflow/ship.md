# Ship — Talib extensions

Extends the shared `ship` skill (`.claude/skills/ship/SKILL.md`). Facts live in
[CLAUDE.md § Repo profile](../../CLAUDE.md#repo-profile). No direct pushes to `staging` or `main`, ever: `pre-push`
rejects them, and branch protection is not enforced on this private repo (see CLAUDE.md § Multi-LLM Safety, item 6).

## Preflight

1. **Existing PR.** When continuing an authorized PR, resolve its number, base, head branch and remote head SHA first,
   and work in that branch's worktree. Fast-forward only (local behind and an ancestor of the remote head); dirty or
   diverged → stop and reconcile, preserving the work. Never blind-reset, never force-push.
2. **Role and isolation.** `.claude/session-role` set, inside a worktree, `.githooks/.installed` present.
3. **Cycle doc complete.** Every task ticked; `## Implementation` opens with the `Plan:` bullet
   ([build.md § Plan](build.md#plan)), a bullet invoking the inline exception counts if it says why; `## Verification`
   holds the verify-local evidence block; `## Ship Notes` filled.
4. **Docs audit.** `bash scripts/audit-docs.sh` exits 0. Any `fail` row blocks: fix the doc on this branch and commit.
   `warn` rows are informational.
5. **JTBD library.** If the cycle changed a portal capability and `docs/uat/jobs/<portal>.md` was not updated, warn
   the user.
6. **Classify the actual diff** (`origin/staging...HEAD`, or the PR's base-to-head), never from the cycle doc. Record
   the compared SHA and changed paths in `## Verification`. Exactly one route:
   - **Documentation-only:** the shared docs-only skip.
   - **Auth-impacting or uncertain:** Google login, OAuth callback, session, cookies, auth guards, auth dependencies,
     or dependency behavior that may affect authentication. Local verify-local before merge **and** the signed-in
     staging check after merge ([§ Post-merge](#post-merge)), even if demo mode passes. When unclear, choose this.
   - **Other code:** verify-local only ([verify.md](verify.md)). Demo auth alone does not cover the database part.

   Classify before checking which browser tools exist; route on the evidence required, never on model or harness.
   An evidence-only docs commit after the verified SHA does not invalidate the evidence; a code change does.
7. **Soft-skip + DEMO_MODE-skip delta check** (catches new vacuous-green tests landing on the ship gate). A test that 100%-skips in CI exists only to inflate the green-tick count; once accumulated, the suite looks healthy while losing coverage. This check counts the soft-skip + DEMO_MODE-gate occurrences on the current branch and against `origin/staging`. Existing skips are grandfathered (they may be load-bearing in ways the audit cannot see); only the **delta** blocks `ship`.

```bash
git fetch origin staging --quiet

# Count soft-skip + DEMO_MODE-gate occurrences in test files only.
# Patterns matched:
#   - test.skip(true,  / it.skip(true,  / describe.skip(  — Playwright
#     and vitest static skips that resolve to "always skip" in CI
#   - test.skip()  — Playwright no-arg always-skip form (terse evasion
#     path: a future author could vacuously green a test with one line)
#   - test.skip($  / it.skip($  — multi-line invocations where the
#     condition lives on the next line (catches dynamic env-conditional
#     skips like `test.skip(\n  !SUPABASE_ENV_READY,\n  "preview-verify
#     covers this surface"\n);` — same anti-pattern as DEMO_MODE-gated
#     skips, missed by the literal-arg patterns above. Tradeoff: also
#     matches multi-line `test.skip(true, ...)` and multi-line
#     `test.skip(!seedFixture, ...)` — those are grandfathered (counted
#     in the baseline) and the delta-only rule still blocks growth.
#   - process.env.DEMO_MODE === "true"  — gate that always fires in CI
#     (CI sets DEMO_MODE=true), often paired with test.skip(...)
#
# Known gaps (NOT caught by this regex — possible future evasion paths):
#   - test.skip(callback, reason) — top-of-file/describe predicate form,
#     e.g. test.skip(({ browserName }) => browserName !== 'webkit', '…').
#     Hard to distinguish via regex from legitimate single-test gates.
#     If a PR adds this pattern, reviewer must catch it manually.
#   - Custom-named env-conditional helpers that evaluate to false in CI
#     but aren't named in `!ALL_CAPS` form — e.g. `test.skip(notReady,…)`
#     where `notReady` is a variable. The line ends with a non-EOL char
#     so `test\.skip\($` misses it.
#
# Both sides use `git grep -c` so the file set + path resolution are
# symmetric (mixing filesystem grep with `git grep` against a ref
# produces a method-asymmetric delta — files that exist only in one
# tree would silently miscount). `:(glob)` pathspecs restrict to test
# files so source files that legitimately branch on DEMO_MODE (e.g.
# `lib/xendit/client.ts`) are not counted.
SKIP_REGEX='test\.skip\(true,|it\.skip\(true,|describe\.skip\(|process\.env\.DEMO_MODE === "true"|test\.skip\($|it\.skip\($|test\.skip\(\)'
PATHSPECS=':(glob)**/*.test.ts :(glob)**/*.test.tsx :(glob)**/*.spec.ts :(glob)**/*.spec.tsx'

CURRENT_SKIPS=$(git grep -cE "$SKIP_REGEX" HEAD -- $PATHSPECS 2>/dev/null \
  | awk -F: '{s+=$NF} END {print s+0}')
BASE_SKIPS=$(git grep -cE "$SKIP_REGEX" origin/staging -- $PATHSPECS 2>/dev/null \
  | awk -F: '{s+=$NF} END {print s+0}')

echo "Soft-skip + DEMO_MODE-skip delta vs origin/staging:"
echo "  baseline=$BASE_SKIPS  current=$CURRENT_SKIPS  delta=$((CURRENT_SKIPS - BASE_SKIPS))"

if [ "$CURRENT_SKIPS" -gt "$BASE_SKIPS" ]; then
  echo ""
  echo "/ship precondition failed: this branch introduces $((CURRENT_SKIPS - BASE_SKIPS))"
  echo "new soft-skip / DEMO_MODE-gate test(s). Skipped tests in CI = vacuous"
  echo "green — they exist only to inflate the green-tick count."
  echo ""
  echo "Resolve one of:"
  echo "  - Convert the new skip into a hard assertion (preferred)."
  echo "  - Replace the test with one that actually exercises the surface."
  echo "  - If this is a legitimate WIP gate (e.g., describe.skip for an"
  echo "    undeployed feature), document it in the cycle doc's"
  echo "    ## Verification AND keep delta ≤ 0 by removing an equivalent"
  echo "    soft-skip in the same cycle. Existing legitimate skips are"
  echo "    grandfathered; the audit only blocks net growth."
  exit 1
fi
```

If the delta is positive, stop and hand back to the user. Do not open a PR on a regression-on-the-gate.

## PR body

```bash
MODEL=$(grep '^model=' .claude/session-role | cut -d= -f2-)
gh label create "model:$MODEL" --color 5319E7 --description "Built by $MODEL" 2>/dev/null || true
```

- Title `[<model>] <cycle title>`; labels `model:<model>`, plus `e2e` per [§ CI](#ci).
- Open it **ready**, not draft: drafts get no CI at all.
- After the shared body, add `Cycle: docs/cycles/<file>.md`, `Role: cto`, `Model: <model>`.
- If `gh` is unavailable, a connected GitHub tool doing the same PR, label, check and merge operations is fine (pass the
  verified head as `expected_head_sha` on merge).

## CI

- Ready PRs run `Docs sync` (`docs-check.yml`: doc-sync rule, `audit-docs.sh`, audit/hook regression tests,
  `sync-agent-workflow.sh --check`) and `Lint, Typecheck & Test`, `Build`, `Keepalive & Alert Self-Test` (`ci.yml`).
  All must be green on the head SHA.
- `Playwright E2E` and `Backup Pipeline Self-Test` (`e2e.yml`) run on a PR only when it carries the **`e2e`** label
  (adding the label starts them). Add it when the diff touches a user flow (`app/`, `components/`, `lib/`, `prisma/`,
  `proxy.ts`, `e2e/`) or the backup pipeline; then both must be green too. Without the label they show as skipped,
  which is expected, not a pass of local e2e.
- Vercel builds only `staging` and `main` (`scripts/vercel-ignore.sh`): no PR preview exists, never wait for one.
- A test that fails in CI but passes locally: `bash scripts/flake-hunt.sh` before calling it a flake.

## Merge

1. Auth-impacting route: add the `needs-staging-verify` label **before** merging and list the signed-in flows in
   Ship Notes. Labelling after would leave a window in which a concurrent promotion sees no label.
2. Refresh the PR head and base right before merging. Head moved past the verified SHA with code → re-run verify-local;
   with docs only → just re-confirm the checks on the new head.
3. `gh pr merge <n> --squash --delete-branch --match-head-commit <head-sha>`.

Fix commits during the fix loop: `fix(<scope>): <what was broken>`, body `Found by local verification round <n>.` and
the `Cycle:` line; update `## Verification` in the same commit so doc-sync passes. The shared stop rule's `needs-human` label
does not exist yet; create it once with `gh label create needs-human --color B60205`.

## Post-merge

1. **Staging deploy.** Find the deployment for the merge SHA (Vercel MCP `list_deployments` / `get_deployment`,
   project `annisaa-erp-v3`, branch `staging`). Poll every 10 s until `READY`, max 5 minutes; stable URL
   `https://annisaa-erp-v3-git-staging-ismails-projects-196d40d3.vercel.app`. Not ready or failed → tell the user;
   a failed staging build is a red staging branch, fix forward before anything else.
2. **Signed-in staging check** (auth-impacting only). Needs browser access to the user's signed-in Chrome profile;
   check the tools directly, never infer from the model.
   - Flows: derive from the merged diff (cycle `## Implementation` is context, not scope). Page → open, screenshot,
     click each primary CTA once. Admin module → list → detail → edit → save. Portal → walk it as that portal's user.
     2–4 flows; past 4, take the highest blast radius (mutations > reads, billing/payroll > everything else).
   - Fixtures: [seed-via-CRUD playbook](#seed-via-crud-playbook). **Never** call `/api/admin/seed` or
     `npx prisma db seed` against staging. Reuse existing fixtures; create only what is missing.
   - Walk with Chrome MCP: navigate → read console (errors and warnings apart) → read network (tag 4xx/5xx) → read page
     text → each interaction, re-reading console and network → screenshot after load and after each mutation.
     Classify with [verify.md § Critique](verify.md#critique).
   - Sign in as the account for the portal under test, from `.claude/verify-accounts.json` (gitignored; copy
     `.claude/verify-accounts.example.json` and ask the user for accounts if absent, never guess):

     | Flow / portal | Google account |
     |---|---|
     | admin (`/admin/**`) | `ismailir10@gmail.com` |
     | teacher (`/teacher/**`) | `ismail10rabbanii@gmail.com` |
     | parent (`/parent/**`) | `rightjet.hq@gmail.com` |

     Pick the account in Google's account picker and switch accounts between portals. Never type credentials; if the
     account is not signed in to the profile, stop and ask the user.
   - **Pass** → one `[staging-verify]` comment on the merged PR (merge SHA, deployment URL, flows, blockers=0, minors),
     then remove `needs-staging-verify`.
   - **Blockers** → staging is broken for its users: fix forward at once with a new `fix(...)` cycle PR (or a revert
     PR when the fix is not obvious). Keep the label on the original PR until a staging check passes. Never chain
     past a failed staging check.
   - **No signed-in browser available** → leave the label, tell the user, continue other authorized work.
3. **Cleanup.** From the main checkout: `bash scripts/cleanup-merged.sh --yes` (removes merged `feat/*` worktrees and
   branches).

## Promotion

`/ship --to-main`, only when the user types it. Never self-invoked, never the tail of a cycle.

1. Role is `cto`, else refuse.
2. Nothing to promote unless staging is ahead:
   ```bash
   git fetch origin main staging
   AHEAD=$(git rev-list --count origin/main..origin/staging)
   [ "$AHEAD" = "0" ] && echo "staging is not ahead of main — nothing to promote."
   ```
3. No unverified auth change may reach production:
   ```bash
   PENDING=$(gh pr list --base staging --state merged --label needs-staging-verify --json number,title --jq '.[] | "#\(.number) \(.title)"')
   [ -n "$PENDING" ] && { echo "Refusing to promote — signed-in staging check still pending for:"; echo "$PENDING"; }
   ```
   Run the signed-in staging check for each (or have the user confirm it by hand), remove the label, re-run.
4. Open the PR `staging` → `main`, title `[<model>] Promote staging → main (<AHEAD> commits)`, labels `model:<model>`
   and `promotion`, body: summary, the cycle docs merged since main
   (`git log --format='%s' origin/main..origin/staging -- docs/cycles/ | grep -oE 'docs/cycles/[^ ]+\.md' | sort -u`,
   falling back to the commit list), and `git log --format='- %s' origin/main..origin/staging`. Add `e2e` so the
   heavy jobs run on the promotion.
5. **Stop and hand off.** Print the PR URL and exactly:
   ```
   Watch CI live:
     gh pr checks <n> --watch
   Merge only after confirming the current PR head/base and every required check is fresh and green (merge commit — NOT squash):
     gh pr merge <n> --merge --match-head-commit <head-sha>
   ```
   The user merges. **`--merge`, never `--squash`**: a squashed promotion makes staging stop being an ancestor of main
   and the branches diverge for good (#381 → #406, #465). No `--delete-branch`: `staging` is permanent.
6. Drain the dependabot queue at each promotion ([CLAUDE.md § Dependency cadence](../../CLAUDE.md#dependency-cadence)).

## Seed-via-CRUD playbook

Reference for the signed-in staging check and for local fixtures the seed lacks. When the cycle's flows need fixtures, the AI uses Chrome MCP to create them **through the admin UI** — never via `/api/admin/seed` or direct DB writes. The table below maps cycle scope (keyword in the cycle's `## Implementation` section) to the fixture chain.

| Cycle scope keyword(s) | Fixtures needed (in order) | Admin pages to walk |
|---|---|---|
| `invoice`, `billing`, `fee`, `xendit`, `payment` | academic year → fee structure → student → guardian → enrollment → invoice | `/admin/academic` → `/admin/fees` → `/admin/students` → `/admin/guardians` → `/admin/enrollments` → `/admin/invoices` |
| `assessment`, `raport`, `score`, `grade`, `curriculum` | academic year → class → curriculum → student → enrollment → assessment session → score | `/admin/academic` → `/admin/curriculum` → `/admin/students` → `/admin/enrollments` → `/admin/assessments` |
| `salary`, `payroll`, `employee` | employee → position → salary structure → payroll run | `/admin/(hr)/employees` → `/admin/(hr)/positions` → `/admin/(hr)/salary` → `/admin/(hr)/payroll` |
| `attendance`, `journal` | academic year → class → student → enrollment → attendance entry | `/admin/academic` → `/admin/students` → `/admin/enrollments` → `/admin/student-attendance` (or `/admin/student-journal`) |
| `admission`, `applicant`, `daftar` | open admission cycle → applicant submission → decision | `/admin/admissions` (admin) + public `/daftar` (applicant flow if cycle touches the public path) |
| `teaching-assignment`, `homeroom` | teacher employee → academic year → class → assignment | `/admin/(hr)/employees` → `/admin/academic` → `/admin/teaching-assignments` |
| `parent`, `parent-portal`, `household` | guardian → student → enrollment → invoice or attendance (whichever the flow exercises) | `/admin/guardians` → `/admin/students` → `/admin/enrollments` → [domain page] |
| `teacher`, `teacher-portal` | teacher employee → teaching assignment → class roster | `/admin/(hr)/employees` → `/admin/teaching-assignments` → walk teacher portal |
| `auth`, `role`, `permission`, `super-admin`, `school-admin` | (no fixtures — switch active demo identity via the demo-role picker) | demo-role picker in admin shell header |
| `branding`, `design-system`, `theme`, `voice` | (no fixtures — visual / copy verification only) | walk pages mentioned in Implementation directly |

**Rules**

- **Use existing fixtures where possible.** Re-running the chain on every iteration is wasteful — check the admin lists first; only create what's missing.
- **Clean up on a clean-pass loop only when the cycle's scope is destructive** (e.g., a soft-delete cycle); otherwise leave fixtures in place — they aid the next staging check.
- **Never escalate scope.** If the playbook for the cycle's scope keyword doesn't exist, fall back to: walk every admin page mentioned in `## Implementation`, create minimum fixtures inline. Do not invent new fixture chains.
- **Authoritative source on entities.** When the chain references entities not yet documented here, consult `prisma/schema.prisma` for required fields, never the CRUD form's optional fields.
