import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { generateAccessToken, tokenExpiryFrom } from "@/lib/enrollment/token";
import { sendEnrollmentInviteEmail } from "@/lib/email/enrollment-invite";
import { resolveAppOrigin } from "@/lib/payments/session";
import { recordAudit } from "@/lib/audit";
import { programInTenant, PROGRAM_NOT_FOUND } from "@/lib/admission/program-scope";
import { getProgramFees } from "@/lib/enrollment/fee-config";
import { AUTO_WAIVE_NOTE, REPRICE_FORBIDDEN, createFeeSnapshot, repriceUnpaidFee, type FeeNote } from "@/lib/enrollment/fee-snapshot";
import { ADMIN_FEE_SELECT, toAdminFeeView, type AdminFeeView } from "@/lib/enrollment/fee-admin-view";
import { programIdSchema } from "@/lib/validations/program-id";

const inviteSchema = z.object({
  admissionId: z.string().min(1, "admissionId wajib diisi"),
  // Program and Day Care set the price of the pendaftaran fee, which is created
  // right here (pay-first). Blank / null = "not chosen here".
  programId: z.union([programIdSchema, z.literal(""), z.null()]).optional(),
  dcareAddon: z.boolean().optional(),
});

const PICK_PROGRAM = "Pilih program dulu.";
const PROGRAM_RETIRED = "Program ini sudah tidak aktif. Pilih program lain.";

// Thrown inside the transaction to abort it with a specific HTTP response.
class InviteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

function programError(message: string) {
  return NextResponse.json({ error: "Validasi gagal", errors: [{ field: "programId", message }] }, { status: 400 });
}

/** The application an invite finds for the lead, as far as a resend needs to know it. */
type ExistingApplication = {
  id: string;
  status: string;
  programId: string | null;
  dcareAddon: boolean;
  fee: { status: string } | null;
};

/**
 * The program and Day Care the fee is priced for. A resend that names neither
 * keeps what the application already holds (staff may have changed it in "Ubah
 * data"); a first send falls back to the lead's own program.
 */
function resolveProgramChoice(input: {
  body: { programId?: string | null; dcareAddon?: boolean };
  existing: ExistingApplication | null;
  leadProgramId: string | null;
}): { programId: string | null; dcareAddon: boolean } {
  const requested = input.body.programId === undefined ? undefined : input.body.programId || null;
  return {
    programId: requested !== undefined ? requested : (input.existing?.programId ?? input.leadProgramId ?? null),
    dcareAddon: input.body.dcareAddon ?? input.existing?.dcareAddon ?? false,
  };
}

/**
 * Resend of a formulir that already has its fee row (pay-first): store the choice
 * again and re-price. Runs inside the invite transaction, after the INVITED-guarded
 * token refresh took the row lock.
 *
 *   - UNPAID fee    → repriced (the staff discount percent is kept)
 *   - PAID / WAIVED → untouched, and the application keeps the program and Day Care
 *                     it was priced for (a fee the system closed for a free program
 *                     follows the new choice)
 */
async function resendWithFee(
  tx: Prisma.TransactionClient,
  ctx: { tenantId: string; actorId: string; canEditFees: boolean; programId: string | null; dcareAddon: boolean },
  target: ExistingApplication & { fee: { status: string } },
): Promise<{ feeNote: FeeNote; feeRepriced: boolean }> {
  const { tenantId, programId, dcareAddon } = ctx;
  if (!ctx.canEditFees) {
    // The pre-read can be stale (two sends racing): re-check under the lock before
    // an UNPAID fee is moved by someone without the finance key.
    const [cur, owed] = await Promise.all([
      tx.enrollmentApplication.findUnique({ where: { id: target.id }, select: { programId: true, dcareAddon: true } }),
      tx.enrollmentFee.findFirst({ where: { applicationId: target.id, tenantId, status: "UNPAID" }, select: { id: true } }),
    ]);
    if (owed && cur && (programId !== (cur.programId ?? null) || dcareAddon !== cur.dcareAddon)) {
      throw new InviteError(REPRICE_FORBIDDEN, 403);
    }
  }

  const outcome = await repriceUnpaidFee(tx, { tenantId, applicationId: target.id, programId, dcareAddon, actorId: ctx.actorId });
  if (outcome.note === "unchanged_inactive_program" && target.fee.status === "UNPAID") {
    // An owed fee must never be priced at 0 because its program was retired.
    throw new InviteError("Validasi gagal", 400, [{ field: "programId", message: PROGRAM_RETIRED }]);
  }
  const settled =
    outcome.note === "unchanged_paid" ||
    outcome.note === "unchanged_inactive_program" ||
    (outcome.note === "unchanged_waived" && outcome.fee?.note !== AUTO_WAIVE_NOTE) ||
    outcome.note === "none";
  if (!settled && (programId !== (target.programId ?? null) || dcareAddon !== target.dcareAddon)) {
    await tx.enrollmentApplication.update({ where: { id: target.id, tenantId }, data: { programId, dcareAddon } });
  }
  return { feeNote: outcome.note, feeRepriced: outcome.note === "repriced" };
}

// Admin-gated, but the route triggers an outbound email — cap resends so a
// stuck click can't blast the parent's inbox.
const RATE_LIMIT_PER_MIN = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/enrollments/invite — admin "Kirim Formulir".
 *
 * Body: { admissionId, programId?, dcareAddon? }. Creates (or, if still INVITED,
 * refreshes the token of) a 1:1 EnrollmentApplication prefilled from the inquiry.
 *
 * Pay-first (cycle 2026-10-11-pendaftaran-simplify, decision 10): on the FIRST send
 * the program and the Day Care add-on are chosen here, because they set the price,
 * and the pendaftaran fee is created (UNPAID) in the same transaction, priced from
 * the tenant's ACTIVE program fees. Until it is PAID or WAIVED the parent's link
 * shows the "Bayar dulu" screen. Program = body.programId, else the lead's; none at
 * all, or one that is not an ACTIVE program of this school, is a 400 on `programId`.
 * A free program creates no fee (the form opens at once).
 *
 * A resend (the application is still INVITED) refreshes the link, and then:
 *   - fee UNPAID    → the choice is stored again and the fee repriced (the staff
 *                     discount percent is kept); changing the program / Day Care
 *                     needs `fees.edit` on top (403)
 *   - fee PAID / WAIVED → untouched, and the stored program / Day Care stay as they
 *                     are (the program is not even validated: a paid form is always
 *                     resendable, whatever happened to its program since)
 *   - NO fee row    → only the link is refreshed. A formulir sent before pay-first,
 *                     or on a free program, keeps its order; no fee is created, the
 *                     program and Day Care are not touched or required (`fee: null`)
 *
 * An email is NOT required: a walk-in with only a phone gets the same application,
 * and staff share the returned `formUrl` (WhatsApp, copy, or fill together on the
 * school's device). When the inquiry has an email, the parent is also best-effort
 * emailed the tokenized form link.
 *
 * Response: { id, formUrl, emailed, hasEmail, fee, feeNote? }. `emailed` = the
 * invite email went out; `hasEmail` tells the UI whether "no email" is the reason
 * nothing was sent or the send failed. `fee` is the staff view of the fee row
 * (null when there is none); `feeNote` says what a resend did to an existing fee
 * ("repriced", "unchanged_paid", "unchanged_waived", ...).
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
  const validated = await validateBody(inviteSchema, body);
  if (validated.error) return validated.error;
  const { admissionId } = validated.data;

  const admission = await prisma.admission.findUnique({
    where: { id: admissionId },
    include: {
      enrollmentApplication: {
        select: { id: true, status: true, programId: true, dcareAddon: true, fee: { select: { status: true } } },
      },
    },
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

  const existing: ExistingApplication | null = admission.enrollmentApplication;
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

  const { programId, dcareAddon } = resolveProgramChoice({
    body: validated.data,
    existing,
    leadProgramId: admission.programId ?? null,
  });

  // The choice only matters when a fee is (or may be) priced from it: the first send,
  // or a resend while the fee is still owed. A resend with no fee row (legacy form,
  // free program) or with a settled fee never reads it.
  const choiceMatters = existing == null || existing.fee?.status === "UNPAID";
  if (choiceMatters) {
    if (!programId) return programError(PICK_PROGRAM);
    // "Active" is checked inside the transaction, where the price is computed.
    if (!(await programInTenant(tenantId, programId))) return programError(PROGRAM_NOT_FOUND);
  }

  // Moving the program or Day Care of an UNPAID fee is a pricing decision, the same
  // one "Ubah data" gates behind the finance key. A first send, or a resend that
  // changes nothing, needs only admissions.edit.
  const canEditFees = hasPermission(session, "fees.edit");
  const priceMoves = existing != null && (programId !== (existing.programId ?? null) || dcareAddon !== existing.dcareAddon);
  if (priceMoves && existing?.fee?.status === "UNPAID" && !canEditFees) {
    return NextResponse.json({ error: REPRICE_FORBIDDEN }, { status: 403 });
  }

  // Create the application, or refresh the token of the one still INVITED, and in
  // the same transaction create / reprice its pendaftaran fee. Returns null when
  // the application is no longer INVITED by the time we write (the parent
  // submitted in between) — the caller answers 409.
  async function persist(target: ExistingApplication | null) {
    return prisma.$transaction(async (tx) => {
      let id: string;
      let savedToken = accessToken;
      let feeCreated = false;
      let feeRepriced = false;
      let feeNote: FeeNote | undefined;
      if (target) {
        // Status in the WHERE: the INVITED check and the write are one statement.
        // It also takes the row lock, so a parent submitting waits for this commit.
        const { count } = await tx.enrollmentApplication.updateMany({
          where: { admissionId, tenantId, status: "INVITED" },
          data: { accessToken, tokenExpiresAt },
        });
        if (count === 0) return null;
        id = target.id;
        // No fee row: a legacy form (or a free program) only gets its link refreshed.
        if (target.fee) {
          ({ feeNote, feeRepriced } = await resendWithFee(tx, { tenantId, actorId, canEditFees, programId, dcareAddon }, { ...target, fee: target.fee }));
        }
      } else {
        // Priced from ACTIVE programs only: a retired program must never price at 0.
        const programs = await getProgramFees(tenantId, tx);
        if (!programs.some((p) => p.id === programId)) {
          throw new InviteError("Validasi gagal", 400, [{ field: "programId", message: PROGRAM_RETIRED }]);
        }
        const created = await tx.enrollmentApplication.create({
          data: {
            tenantId,
            admissionId,
            accessToken,
            tokenExpiresAt,
            status: "INVITED",
            childName,
            parentEmail: email ?? null,
            programId,
            dcareAddon,
            studentData,
            ayahData,
            ibuData,
          },
          select: { id: true, accessToken: true },
        });
        id = created.id;
        savedToken = created.accessToken;
        feeCreated = (await createFeeSnapshot(tx, { tenantId, applicationId: id, programs, programId, dcareAddon })) !== null;
      }

      const feeRow =
        feeCreated || target?.fee
          ? await tx.enrollmentFee.findFirst({ where: { applicationId: id, tenantId }, select: { ...ADMIN_FEE_SELECT, id: true } })
          : null;
      // Field names and flags only — never the token, contact or child data (PII).
      await recordAudit(
        {
          tenantId,
          actorId,
          entity: "EnrollmentApplication",
          entityId: id,
          action: target ? "resend_invite" : "invite",
          after: { admissionId, hasEmail: Boolean(email), feeCreated, feeRepriced, feeId: feeRow?.id ?? null },
        },
        tx,
      );
      return { id, accessToken: savedToken, fee: feeRow ? toAdminFeeView(feeRow) : null, feeNote };
    });
  }

  type Persisted = { id: string; accessToken: string; fee: AdminFeeView | null; feeNote: FeeNote | undefined };
  let app: Persisted | null;
  try {
    app = await persist(existing);
  } catch (err) {
    if (err instanceof InviteError) {
      return NextResponse.json(err.errors ? { error: err.message, errors: err.errors } : { error: err.message }, { status: err.status });
    }
    // Unique admissionId: two sends raced and the other created the application
    // first. Look again — still INVITED means refresh it, anything else is in progress.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const raced = await prisma.enrollmentApplication.findUnique({
      where: { admissionId },
      select: { id: true, status: true, tenantId: true, programId: true, dcareAddon: true, fee: { select: { status: true } } },
    });
    if (!raced || raced.tenantId !== tenantId || raced.status !== "INVITED") return inProgress();
    app = await persist(raced);
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
  return NextResponse.json({
    id: app.id,
    emailed,
    hasEmail: Boolean(email),
    formUrl,
    fee: app.fee,
    ...(app.feeNote && app.feeNote !== "none" ? { feeNote: app.feeNote } : {}),
  });
}
