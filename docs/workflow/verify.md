# Verify — Talib extensions

Extends the shared `verify-local` skill (`.claude/skills/verify-local/SKILL.md`). Everything here runs on this
machine against a **disposable local Postgres** with **demo auth**. Never against staging or production data.

## Run the app

The repo `.env` points at the shared staging Supabase, and `prisma.config.ts` prefers `DIRECT_URL` over
`DATABASE_URL`. Export **both** to the disposable database in the shell that runs every command below.

```bash
docker run -d --name talib-verify-pg -p 54329:5432 \
  -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=schoolerp postgres:15
until docker exec talib-verify-pg pg_isready -U ci >/dev/null 2>&1; do sleep 1; done
export DATABASE_URL=postgresql://ci:ci@localhost:54329/schoolerp DIRECT_URL=postgresql://ci:ci@localhost:54329/schoolerp
case "$DATABASE_URL $DIRECT_URL" in *localhost:54329*localhost:54329*) ;; *) echo "STOP: not the disposable DB"; exit 1;; esac
npx prisma db push --force-reset   # drops every table: the disposable DB only, never staging/prod
npx prisma db seed
```

Postgres already running locally on another port is fine too, as long as both URLs point at a throwaway database.
No Docker and no local Postgres → stop and ask (working-principles § 3.6).

## Full gate

```bash
npm run lint
npx vitest run                                    # no DEMO_MODE in this env: auth/payment assertions expect normal mode
bash scripts/verify-rls-coverage.sh && bash scripts/verify-api-auth.sh
DEMO_MODE=true NEXTAUTH_SECRET=local-dummy npm run build
npx playwright test                               # starts `DEMO_MODE=true npm run start` itself, Chromium, workers: 1
```

Run `npx playwright test` with nothing on port 3000: it starts its own server with the Xendit/DOKU test stubs from
`playwright.config.ts`, and refuses a non-local `DATABASE_URL` (never set `E2E_ALLOW_REMOTE_DB`). E2E is required for
any diff that touches a user flow; CI's `Playwright E2E` only runs when the PR carries the `e2e` label, so it is not a
substitute. Playwright cannot run (browsers missing, Turbopack symlink issue, …) → stop and ask; never record a
deferral to CI.

## Sign in

Start the production build for the walk with the same stubs Playwright uses:

```bash
DEMO_MODE=true NEXTAUTH_SECRET=local-dummy XENDIT_SECRET_KEY=test-secret XENDIT_WEBHOOK_TOKEN=test-webhook-token \
  DOKU_CLIENT_ID=test-doku-client-id DOKU_SECRET_KEY=test-doku-secret-key DOKU_ENV=sandbox npm run start
curl -fs http://localhost:3000 >/dev/null && echo up
```

(`.claude/launch.json` → `next-prod-demo` starts the same server in the Claude preview pane; export the variables
above first.) A production build's login guard returns 403 even in demo mode, so sign in by setting the
`school-erp-session` cookie (domain `localhost`, path `/`, httpOnly, `sameSite: Lax`) to a seeded user id, as
`e2e/admin-dashboard.spec.ts` does. Under `next dev`, use the demo login picker instead. Never weaken the auth
guard, and never reuse these cookies on staging or any shared host.

| Role | Cookie value | Persona to act as |
|---|---|---|
| Super admin | `u_super_admin` | Ibu Nur ([`.claude/personas/ibu-nur.md`](../../.claude/personas/ibu-nur.md)) |
| School admin (limited) | `u_school_admin` | none yet (the Bu Lina persona is pending; act as a cautious admin) |
| Teacher | `u_teacher` | Bu Sari ([`.claude/personas/bu-sari.md`](../../.claude/personas/bu-sari.md)) |
| Parent | `u_rightjet` | Pak Budi ([`.claude/personas/pak-budi.md`](../../.claude/personas/pak-budi.md)) |

## Walk

- Teacher and parent portals are phone-first: walk them at 390×844 first, then desktop. Admin is desktop-first.
- Fixtures missing from the seed: create them through the admin UI, following the
  [seed-via-CRUD playbook](ship.md#seed-via-crud-playbook). Never write to the DB directly.
- Record the route in the evidence block's App line: `production build, demo auth + disposable local Postgres`.
  For an auth-impacting diff, add `Staging check: pending (needs-staging-verify)`.

## Critique

Blockers, on top of the shared list:

- console `error`; any response ≥ 500; a primary click with no DOM change and no request within 2 s; a form submit
  that sends no request; navigation that loops back to sign-in;
- a timing past the `/uat` blocker thresholds (page > 4 s, API > 2 s, click-to-visible > 3 s), see
  [`/uat` performance thresholds](../../.claude/skills/uat/SKILL.md#performance-thresholds-non-negotiable);
- a frontend change that contradicts `.claude/standards/design-system.html` or the standards loaded for the task.

Minor (note it, don't block): console warnings, 4xx on optional probes (favicon, `/api/auth/session` on first paint),
copy or spacing nits that don't break understanding.

When done, stop the server and `docker rm -f talib-verify-pg`.
