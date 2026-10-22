/**
 * Demo auth gate — the single answer to "may the raw `school-erp-session`
 * cookie stand in for a Supabase session?".
 *
 * Demo auth trusts an unsigned cookie holding a User id, so honouring it on a
 * deployed environment is a whole-tenant takeover (`school-erp-session=
 * u_super_admin`). `DEMO_MODE=true` alone used to be enough; one copied env
 * set on Vercel would have opened staging or production. Now it also requires
 * that the process is not running on Vercel (`VERCEL` is set at build and
 * runtime there). Local `next dev`, local `next start` for Playwright, and CI
 * runners keep working because none of them set `VERCEL`.
 *
 * Same rule as the demo storage backend in lib/storage/index.ts.
 * Re-read per call — env can change between tests.
 */
export function isDemoAuthEnabled(): boolean {
  if (process.env.DEMO_MODE !== "true") return false;
  if (process.env.VERCEL) {
    console.error("[AUTH] DEMO_MODE=true ignored on Vercel — demo auth is local-only");
    return false;
  }
  return true;
}
