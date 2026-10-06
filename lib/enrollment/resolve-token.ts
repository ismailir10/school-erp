import { prisma } from "@/lib/db";
import { isTokenExpired } from "./token";

/**
 * Access classification for a tokenized enrollment form. The token is the only
 * credential, so callers (the RSC page + the public token routes) MUST funnel
 * every lookup through here and branch on `access`:
 *   - OK         → editable (status INVITED, not expired)
 *   - NOT_FOUND  → bad/unknown token → render a generic non-leaking page
 *   - EXPIRED    → token past its 14d TTL → ask the parent to request a new link
 *   - SUBMITTED  → already filled (any status past INVITED) → thank-you page
 */
export type EnrollmentAccess = "OK" | "NOT_FOUND" | "EXPIRED" | "SUBMITTED";

export type EnrollmentRow = {
  id: string;
  status: string;
  tokenExpiresAt: Date | null;
};

/**
 * Pure classifier — no DB. `null` row (token miss) → NOT_FOUND. A row past
 * INVITED is treated as already-submitted regardless of expiry (the form is
 * done; expiry is moot). Only an unexpired INVITED row is editable.
 */
export function classifyEnrollmentAccess(row: EnrollmentRow | null, now: Date): EnrollmentAccess {
  if (!row) return "NOT_FOUND";
  if (row.status !== "INVITED") return "SUBMITTED";
  if (isTokenExpired(row.tokenExpiresAt, now)) return "EXPIRED";
  return "OK";
}

export type ResolvedEnrollment = {
  access: EnrollmentAccess;
  application: {
    id: string;
    status: string;
    childName: string;
    parentEmail: string | null;
    programId: string | null;
    dcareAddon: boolean;
    tokenExpiresAt: Date | null;
    studentData: unknown;
    ayahData: unknown;
    ibuData: unknown;
    consentData: unknown;
    documents: unknown;
  } | null;
};

/**
 * Lean access check for the write routes (PATCH/submit/signature) — selects
 * only what classification + the follow-up update need (`id` + status +
 * expiry), avoiding pulling the four JSON blobs the RSC prefill needs but the
 * mutations discard.
 */
export async function resolveEnrollmentAccess(
  token: string,
  now: Date,
): Promise<{ access: EnrollmentAccess; id: string | null; tenantId: string | null }> {
  const row = await prisma.enrollmentApplication.findUnique({
    where: { accessToken: token },
    select: { id: true, status: true, tokenExpiresAt: true, tenantId: true },
  });
  return { access: classifyEnrollmentAccess(row, now), id: row?.id ?? null, tenantId: row?.tenantId ?? null };
}

/**
 * True when `programId` is a non-empty id owned by `tenantId`. Used by every
 * write path that persists a client-supplied programId (admin PATCH, public
 * draft + submit) to prevent a cross-tenant program reference (IDOR write).
 */
export async function programBelongsToTenant(programId: string, tenantId: string): Promise<boolean> {
  if (!programId) return false;
  const prog = await prisma.program.findFirst({
    where: { id: programId, tenantId },
    select: { id: true },
  });
  return prog != null;
}

/**
 * Full resolver — also returns the prefill blobs. Used by the RSC page to seed
 * the form. Callers still inspect `access` before trusting it for edits.
 */
export async function resolveEnrollmentToken(token: string, now: Date): Promise<ResolvedEnrollment> {
  const application = await prisma.enrollmentApplication.findUnique({
    where: { accessToken: token },
    select: {
      id: true,
      status: true,
      childName: true,
      parentEmail: true,
      programId: true,
      dcareAddon: true,
      tokenExpiresAt: true,
      studentData: true,
      ayahData: true,
      ibuData: true,
      consentData: true,
      documents: true,
    },
  });
  return { access: classifyEnrollmentAccess(application, now), application };
}
