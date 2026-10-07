import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { generateAccessToken, tokenExpiryFrom } from "@/lib/enrollment/token";
import { sendEnrollmentInviteEmail } from "@/lib/email/enrollment-invite";
import { resolveAppOrigin } from "@/lib/payments/session";

const inviteSchema = z.object({ admissionId: z.string().min(1, "admissionId wajib diisi") });

// Admin-gated, but the route triggers an outbound email — cap resends so a
// stuck click can't blast the parent's inbox.
const RATE_LIMIT_PER_MIN = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/enrollments/invite — admin "Kirim Formulir".
 *
 * Body: { admissionId }. Requires the Admission to have a parentEmail (we can't
 * email without one → 422 NO_EMAIL). Creates (or, if still INVITED, refreshes
 * the token of) a 1:1 EnrollmentApplication prefilled from the inquiry, then
 * best-effort emails the parent the tokenized form link.
 *
 * Idempotent via admissionId @unique:
 *   - no application yet            → create INVITED + mint token
 *   - existing INVITED              → refresh token + expiry (resend)
 *   - existing SUBMITTED/…/ACCEPTED → 409 ALREADY_IN_PROGRESS (don't reset
 *     a form the parent already filled)
 *
 * Prefill is intentionally minimal + safe: child name/DOB/gender and the
 * matching parent block's name/phone/email only. We do NOT prefill
 * education/occupation/income — the thin Admission stores those in a different
 * vocabulary (e.g. "S1", "Rp 3-5 Juta") than the enrollment option sets, so
 * copying them would seed invalid select values.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = rateLimit(`enroll-invite:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "admissionId wajib diisi" }, { status: 400 });
  }
  const { admissionId } = parsed.data;

  const admission = await prisma.admission.findUnique({
    where: { id: admissionId },
    include: { enrollmentApplication: { select: { id: true, status: true } } },
  });
  if (!admission || admission.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const email = admission.parentEmail?.trim();
  if (!email) {
    return NextResponse.json(
      {
        error: "NO_EMAIL",
        message:
          "Pendaftaran ini belum memiliki email orang tua. Tambahkan email lebih dahulu lalu kirim ulang.",
      },
      { status: 422 },
    );
  }

  const existing = admission.enrollmentApplication;
  if (existing && existing.status !== "INVITED") {
    return NextResponse.json(
      {
        error: "ALREADY_IN_PROGRESS",
        message: "Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang.",
      },
      { status: 409 },
    );
  }

  const now = new Date();
  const accessToken = generateAccessToken();
  const tokenExpiresAt = tokenExpiryFrom(now);

  // Map the inquiry's single parent block onto the matching enrollment block.
  // Only when the inquiry contact is explicitly the father or mother — for
  // WALI/OTHER (or unset), prefill neither block; the parent fills both fresh.
  const rel = admission.parentRelationship;
  const parentPrefill = {
    name: admission.parentName,
    // Staff often fill only the WhatsApp field of the inquiry; `||` also skips
    // a blank phone string.
    phone: admission.parentPhone || admission.parentWhatsapp || undefined,
    email: admission.parentEmail ?? undefined,
  };
  const ayahData = rel === "AYAH" ? parentPrefill : undefined;
  const ibuData = rel === "IBU" ? parentPrefill : undefined;

  const studentData = {
    childName: admission.childName,
    dateOfBirth: admission.dateOfBirth ?? undefined,
    childGender: admission.childGender ?? undefined,
  };

  const app = await prisma.enrollmentApplication.upsert({
    where: { admissionId },
    create: {
      tenantId: session.tenantId,
      admissionId,
      accessToken,
      tokenExpiresAt,
      status: "INVITED",
      childName: admission.childName,
      parentEmail: email,
      programId: admission.programId ?? null,
      dcareAddon: false,
      studentData,
      ayahData,
      ibuData,
    },
    update: { accessToken, tokenExpiresAt },
    select: { id: true, accessToken: true },
  });

  // requestOrigin (new URL(req.url).origin) is always present in a route
  // handler, so preview/staging/prod each get their own host here — same
  // pattern as payment return URLs (lib/payments/session.ts). No hardcoded
  // prod fallback: a staging-triggered email must never link to prod.
  const appUrl = resolveAppOrigin(new URL(req.url).origin);
  const formUrl = `${appUrl}/pendaftaran/${app.accessToken}`;

  let sent = false;
  try {
    const result = await sendEnrollmentInviteEmail({
      tenantId: session.tenantId,
      to: email,
      childName: admission.childName,
      parentName: admission.parentName,
      formUrl,
      appUrl,
    });
    sent = result.sent;
    if (!result.sent && result.error) {
      console.error(`[enrollments/invite] email failed for application ${app.id}: ${result.error}`);
    }
  } catch (err) {
    console.error(`[enrollments/invite] email threw for application ${app.id}`, err);
  }

  // formUrl is returned ONLY to the inviting admin (who is already trusted and
  // would receive the same link via the email) so staff can also copy/WhatsApp
  // it. It is never logged or written to EmailLog.
  return NextResponse.json({ id: app.id, sent, formUrl });
}
