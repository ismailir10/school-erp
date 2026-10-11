import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { generateAccessToken, tokenExpiryFrom } from "@/lib/enrollment/token";
import { sendEnrollmentInviteEmail } from "@/lib/email/enrollment-invite";
import { resolveAppOrigin } from "@/lib/payments/session";
import { recordAudit } from "@/lib/audit";

const inviteSchema = z.object({ admissionId: z.string().min(1, "admissionId wajib diisi") });

// Admin-gated, but the route triggers an outbound email — cap resends so a
// stuck click can't blast the parent's inbox.
const RATE_LIMIT_PER_MIN = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/enrollments/invite — admin "Kirim Formulir".
 *
 * Body: { admissionId }. Creates (or, if still INVITED, refreshes the token of)
 * a 1:1 EnrollmentApplication prefilled from the inquiry. An email is NOT
 * required: a walk-in with only a phone gets the same application, and staff
 * share the returned `formUrl` (WhatsApp, copy, or fill together on the
 * school's device). When the inquiry has an email, the parent is also
 * best-effort emailed the tokenized form link.
 *
 * Response: { id, formUrl, emailed, hasEmail }. `emailed` = the invite email
 * went out; `hasEmail` tells the UI whether "no email" is the reason nothing
 * was sent or the send failed.
 *
 * Idempotent via admissionId @unique:
 *   - no application yet            → create INVITED + mint token
 *   - existing INVITED              → refresh token + expiry (resend); the
 *     INVITED check is part of the UPDATE's WHERE, so a parent submitting
 *     between our read and write can never have their form's token swapped
 *   - existing SUBMITTED/…/ACCEPTED → 409 ALREADY_IN_PROGRESS (don't reset
 *     a form the parent already filled)
 *   - cancelled or already-converted lead → 409 LEAD_CLOSED
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

  if (admission.status === "CANCELLED" || admission.studentId) {
    return NextResponse.json(
      {
        error: "LEAD_CLOSED",
        message: admission.studentId
          ? "Calon siswa ini sudah menjadi siswa — formulir tidak bisa dikirim lagi."
          : "Pendaftaran ini sudah dibatalkan — formulir tidak bisa dikirim.",
      },
      { status: 409 },
    );
  }

  // Optional: a lead without an email still gets a form link (walk-ins).
  const email = admission.parentEmail?.trim() || undefined;

  const existing = admission.enrollmentApplication;
  const inProgress = () =>
    NextResponse.json(
      {
        error: "ALREADY_IN_PROGRESS",
        message: "Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang.",
      },
      { status: 409 },
    );
  if (existing && existing.status !== "INVITED") return inProgress();

  const now = new Date();
  const accessToken = generateAccessToken();
  const tokenExpiresAt = tokenExpiryFrom(now);

  // Map the inquiry's single parent block onto the matching enrollment block.
  // Only when the contact is explicitly the father (AYAH) or mother (IBU) — for
  // WALI (or unset), prefill neither block; the parent fills both fresh.
  const rel = admission.parentRelationship;
  const parentPrefill = {
    name: admission.parentName,
    // Staff often fill only the WhatsApp field of the inquiry; `||` also skips
    // a blank phone string.
    phone: admission.parentPhone || admission.parentWhatsapp || undefined,
    email: email ?? undefined,
  };
  const ayahData = rel === "AYAH" ? parentPrefill : undefined;
  const ibuData = rel === "IBU" ? parentPrefill : undefined;

  // A lead may have no child data yet (child fields are optional): copy only
  // what is actually filled so the parent never starts on blank-but-"set" values.
  const childName = admission.childName?.trim() ?? "";
  const studentData = {
    ...(childName ? { childName } : {}),
    ...(admission.dateOfBirth ? { dateOfBirth: admission.dateOfBirth } : {}),
    ...(admission.childGender ? { childGender: admission.childGender } : {}),
  };

  // Narrowed once here: `session.tenantId` loses its non-null type inside the closure.
  const tenantId = session.tenantId;
  const actorId = session.id;
  const programId = admission.programId ?? null;

  // Create the application, or refresh the token of the one still INVITED.
  // Returns null when the application is no longer INVITED by the time we
  // write (the parent submitted in between) — the caller answers 409.
  async function persist(existingId: string | null) {
    return prisma.$transaction(async (tx) => {
      let saved: { id: string; accessToken: string };
      if (existingId) {
        // Status in the WHERE: the INVITED check and the write are one statement.
        const { count } = await tx.enrollmentApplication.updateMany({
          where: { admissionId, tenantId, status: "INVITED" },
          data: { accessToken, tokenExpiresAt },
        });
        if (count === 0) return null;
        saved = { id: existingId, accessToken };
      } else {
        saved = await tx.enrollmentApplication.create({
          data: {
            tenantId,
            admissionId,
            accessToken,
            tokenExpiresAt,
            status: "INVITED",
            childName,
            parentEmail: email ?? null,
            programId: programId,
            dcareAddon: false,
            studentData,
            ayahData,
            ibuData,
          },
          select: { id: true, accessToken: true },
        });
      }
      // Field names and flags only — never the token, contact or child data (PII).
      await recordAudit(
        {
          tenantId,
          actorId,
          entity: "EnrollmentApplication",
          entityId: saved.id,
          action: existingId ? "resend_invite" : "invite",
          after: { admissionId, hasEmail: Boolean(email) },
        },
        tx,
      );
      return saved;
    });
  }

  let app: { id: string; accessToken: string } | null;
  try {
    app = await persist(existing?.id ?? null);
  } catch (err) {
    // Unique admissionId: two sends raced and the other created the application
    // first. Look again — still INVITED means refresh it, anything else is in progress.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const raced = await prisma.enrollmentApplication.findUnique({
      where: { admissionId },
      select: { id: true, status: true, tenantId: true },
    });
    if (!raced || raced.tenantId !== tenantId || raced.status !== "INVITED") return inProgress();
    app = await persist(raced.id);
  }
  if (!app) return inProgress();

  // requestOrigin (new URL(req.url).origin) is always present in a route
  // handler, so preview/staging/prod each get their own host here — same
  // pattern as payment return URLs (lib/payments/session.ts). No hardcoded
  // prod fallback: a staging-triggered email must never link to prod.
  const appUrl = resolveAppOrigin(new URL(req.url).origin);
  const formUrl = `${appUrl}/pendaftaran/${app.accessToken}`;

  let emailed = false;
  if (email) {
    try {
      const result = await sendEnrollmentInviteEmail({
        tenantId: session.tenantId,
        to: email,
        childName,
        parentName: admission.parentName,
        formUrl,
        appUrl,
      });
      emailed = result.sent;
      if (!result.sent && result.error) {
        console.error(`[enrollments/invite] email failed for application ${app.id}: ${result.error}`);
      }
    } catch (err) {
      console.error(`[enrollments/invite] email threw for application ${app.id}`, err);
    }
  }

  // formUrl is returned ONLY to the inviting admin (who is already trusted and
  // would receive the same link via the email) so staff can also copy/WhatsApp
  // it. It is never logged or written to EmailLog.
  return NextResponse.json({ id: app.id, emailed, hasEmail: Boolean(email), formUrl });
}
