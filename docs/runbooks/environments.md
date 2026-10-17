# Runbook — environments and configuration

Moved out of README.md 2026-08-20. README is the repo's public front page; this is deployment procedure.

## Environments

| Environment | Branch | Database | Purpose |
|---|---|---|---|
| Local | any | local Postgres | Demo mode — auth bypassed, DB still required |
| Staging | `staging` | Supabase Singapore, staging project | Pre-production verification |
| Production | `main` | Supabase Singapore, production project | Real users |

Vercel builds via [`scripts/vercel-build.sh`](../../scripts/vercel-build.sh). `prisma migrate deploy` runs on `staging` and `main`. Those are the only two branches Vercel builds: `vercel.json` `ignoreCommand` ([`scripts/vercel-ignore.sh`](../../scripts/vercel-ignore.sh)) skips every other branch, so PRs get no preview deployment. The staging deployment still uses Vercel's *Preview* environment for its env vars.

CI on every ready (non-draft) PR: `Checks` (includes `scripts/audit-docs.sh` and the keepalive/alert self-tests) and `Test & Build` (includes the RLS and API-auth coverage guards and the `DEMO_MODE` production build). `E2E` ([`e2e.yml`](../../.github/workflows/e2e.yml), Playwright plus the backup pipeline self-test) runs on manual dispatch or a PR labelled `e2e` (every promotion PR carries it); pushes to `staging`/`main` run no CI. e2e is run locally before every PR that touches a user flow ([`docs/workflow/verify.md`](../workflow/verify.md)).

## Environment variables

Copy `.env.example` to `.env`. Names only below — values live in Vercel and in the password manager, never in this repo.

| Variable | Local | Staging | Production |
|---|---|---|---|
| `DATABASE_URL` | local Postgres | Supabase pooler (6543) | Supabase pooler (6543) |
| `DIRECT_URL` | optional | Supabase direct (5432) — required¹ | Supabase direct (5432) — required¹ |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | — | staging project | production project |
| `RESEND_API_KEY` (omit → emails simulated) | — | ✔ | ✔ |
| `STAGING_EMAIL_OVERRIDE` | — | admin inbox | — |
| `XENDIT_SECRET_KEY` / `XENDIT_WEBHOOK_TOKEN` | — | sandbox | production |
| `PAYMENT_GATEWAY` (`xendit` \| `doku`; unset → `xendit`) | — | `doku` | `doku` |
| `DOKU_CLIENT_ID` / `DOKU_SECRET_KEY` / `DOKU_ENV` | — | sandbox | production |
| `DOKU_CHECKOUT_VERSION` (`v1` \| `v2`; unset → `v1`) | — | `v1`² | `v1`² |
| `NEXT_PUBLIC_APP_URL` | — | preview origin³ | production origin³ |
| `CRON_SECRET` | — | `openssl rand -hex 32` | `openssl rand -hex 32` |
| `SCHOOL_CONTACT_PHONE` (optional; omit → screens show a generic next step) | — | school number⁴ | school number⁴ |

¹ **`DIRECT_URL` is mandatory on Vercel.** The build runs `prisma migrate deploy`, which needs port 5432 — the 6543 pooler is PgBouncer transaction mode and does not support advisory locks.

² Stays `v1` until a DOKU notification is observed arriving — see [`payments-gateway.md`](payments-gateway.md).

³ **Per-environment, throws if missing.** It is the origin for payment-gateway return URLs when there is no request scope (reseed, cron). There is deliberately no silent production fallback.

⁴ **Public school number, not a secret.** Read server-side by `lib/contact.ts` (`schoolContactPhone()`); shown to parents on the pendaftaran payment page, the pendaftaran message cards and the parent portal (invoice sheet, profile) as a WhatsApp/tel contact. Tenant and campus carry no phone column, so this env var is the single source.

## Related runbooks

- [`payments-gateway.md`](payments-gateway.md) — DOKU/Xendit operations, notification debugging, the v2 probe
- [`reseed-staging.md`](reseed-staging.md) — rebuilding staging data
- [`prod-incident.md`](prod-incident.md) — production incident procedure
- [`pilot-cross-role-test-scenarios.md`](pilot-cross-role-test-scenarios.md) — manual cross-role test script
