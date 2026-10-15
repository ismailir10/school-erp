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
 *
 * The pendaftaran fee never gates the form: it is paid after the parent submits,
 * so an INVITED row is OK whether or not it already has a fee (a formulir sent
 * under the short-lived pay-first order may hold an UNPAID one).
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
  /** Owning tenant of the matched row (undefined on a token miss) — for per-school config lookups. */
  tenantId: string | undefined;
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
    /** The lead behind it: only its status is read, for `isFeeClosed`. */
    admission: { status: string } | null;
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
export async function programBelongsToTenant(
  programId: string,
  tenantId: string,
  db: Pick<typeof prisma, "program"> = prisma,
): Promise<boolean> {
  if (!programId) return false;
  const prog = await db.program.findFirst({
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
  const row = await prisma.enrollmentApplication.findUnique({
    where: { accessToken: token },
    select: {
      id: true,
      tenantId: true,
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
      // Only so the pages can tell a cancelled lead (see `isFeeClosed`); one enum, no contact data.
      admission: { select: { status: true } },
    },
  });
  if (!row) return { access: classifyEnrollmentAccess(null, now), tenantId: undefined, application: null };
  // `tenantId` is surfaced separately and kept off `application`, which the page
  // hands on to the client component.
  const { tenantId, ...application } = row;
  return { access: classifyEnrollmentAccess(row, now), tenantId, application };
}
