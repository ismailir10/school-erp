import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { getProgramFees } from "@/lib/enrollment/fee-config";
import { createFeeSnapshot } from "@/lib/enrollment/fee-snapshot";
import { isPlainObject } from "@/lib/enrollment/staff-edit";
import { ADMIN_FEE_SELECT, toAdminFeeView } from "@/lib/enrollment/fee-admin-view";

/**
 * POST /api/enrollments/[id]/mark-submitted — "Tandai formulir masuk".
 *
 * Staff move a not-yet-submitted formulir (INVITED) to SUBMITTED on the parent's
 * behalf: a walk-in family filled it on paper or told staff the answers, and staff
 * typed them in through "Ubah data". Needs `admissions.edit`; tenant from the
 * session; the row is locked FOR UPDATE like convert, so a parent submitting at the
 * same moment cannot double-flip it.
 *
 * Consent is recorded as "disetujui langsung di sekolah" with who and when. NO
 * signature, signing time or `agreed` flag is invented — those are evidence only
 * the parent writes; anything the parent already stored on the row is kept as is.
 *
 * The pendaftaran fee is snapshotted exactly like a parent submit (same helper)
 * when none exists yet and the program has a fee. It does NOT have to be paid:
 * staff can always proceed (A3: an unpaid application never blocks).
 *
 * Preconditions: status INVITED, not converted (409); a child name and at least
 * one parent name (400, names what is missing). Audited in the same transaction
 * (no PII values).
 */

const CONSENT_NOTE = "Disetujui langsung di sekolah";

type FieldError = { field: string; message: string };

// Thrown inside the transaction to abort it with a specific HTTP response. A
// 400 carries per-field errors (the repo's `Validasi gagal` shape) so the UI can
// map them onto fields; the message is also what the toast shows.
class MarkError extends Error {
  constructor(message: string, readonly status: number, readonly errors?: FieldError[]) {
    super(message);
  }
}

const obj = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {});
const hasText = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";

/**
 * Staff-recorded consent starts from an allowlist of what the parent's draft may
 * legitimately hold: who fills the form, and each signer's name / drawn signature.
 * Everything else a token holder could have pre-seeded — `agreed`, `version`, any
 * extra key — is dropped, so the record never claims an agreement nobody gave.
 */
function allowedConsent(stored: unknown): Record<string, unknown> {
  const src = obj(stored);
  const out: Record<string, unknown> = {};
  if (src.onlyParent === "ayah" || src.onlyParent === "ibu") out.onlyParent = src.onlyParent;
  for (const side of ["ayah", "ibu"] as const) {
    if (src[side] === undefined) continue;
    const block = obj(src[side]);
    const kept: Record<string, unknown> = {};
    for (const key of ["name", "signatureToken", "signedAt"] as const) {
      if (typeof block[key] === "string") kept[key] = block[key];
    }
    out[side] = kept;
  }
  return out;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const limit = rateLimit(`enrollment-mark-submitted:${session.id}`, 30, 60_000);
  if (!limit.success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await tx.$queryRaw<{ studentId: string | null; status: string }[]>`
        SELECT "studentId", "status" FROM "EnrollmentApplication"
        WHERE "id" = ${id} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      if (!locked || locked.length === 0) throw new MarkError("Not found", 404);
      if (locked[0].studentId) throw new MarkError("Pendaftaran ini sudah dikonversi menjadi siswa.", 409);
      if (locked[0].status !== "INVITED") {
        throw new MarkError("Formulir ini sudah ditandai masuk atau sedang diproses.", 409);
      }

      const app = await tx.enrollmentApplication.findUnique({
        where: { id },
        select: {
          childName: true,
          programId: true,
          dcareAddon: true,
          studentData: true,
          ayahData: true,
          ibuData: true,
          consentData: true,
          fee: { select: { id: true } },
        },
      });
      if (!app) throw new MarkError("Not found", 404);

      // Minimum data: name what is missing, so staff know what to fill in first.
      const errors: FieldError[] = [];
      if (!hasText(app.childName) && !hasText(obj(app.studentData).childName)) {
        errors.push({ field: "childName", message: "Nama anak belum diisi. Lengkapi lewat Ubah data." });
      }
      if (!hasText(obj(app.ayahData).name) && !hasText(obj(app.ibuData).name)) {
        errors.push({ field: "ayahData.name", message: "Nama Ayah atau Ibu belum diisi. Lengkapi lewat Ubah data." });
      }
      if (errors.length > 0) throw new MarkError("Validasi gagal", 400, errors);

      // Priced like a parent submit: from the tenant's ACTIVE programs.
      let programs: Awaited<ReturnType<typeof getProgramFees>> = [];
      if (app.programId) {
        programs = await getProgramFees(tenantId, tx);
        if (!programs.some((p) => p.id === app.programId)) {
          throw new MarkError("Validasi gagal", 400, [
            { field: "programId", message: "Program pada formulir ini sudah tidak aktif. Pilih program lain lewat Ubah data." },
          ]);
        }
      }

      const consentData = {
        ...allowedConsent(app.consentData),
        staffRecorded: true,
        note: CONSENT_NOTE,
        by: session.id,
        at: now.toISOString(),
      };
      const flipped = await tx.enrollmentApplication.updateMany({
        where: { id, tenantId, status: "INVITED" },
        data: { status: "SUBMITTED", submittedAt: now, consentData },
      });
      if (flipped.count === 0) throw new MarkError("Formulir ini sudah ditandai masuk atau sedang diproses.", 409);

      let feeCreated = false;
      if (!app.fee && app.programId) {
        const snapshot = await createFeeSnapshot(tx, {
          tenantId,
          applicationId: id,
          programs,
          programId: app.programId,
          dcareAddon: app.dcareAddon,
        });
        feeCreated = snapshot !== null;
      }

      await recordAudit(
        {
          tenantId,
          actorId: session.id,
          entity: "EnrollmentApplication",
          entityId: id,
          action: "mark_submitted",
          before: { status: "INVITED" },
          after: { status: "SUBMITTED", staffRecorded: true, feeCreated },
        },
        tx,
      );

      const fee = await tx.enrollmentFee.findUnique({ where: { applicationId: id }, select: ADMIN_FEE_SELECT });
      return { id, status: "SUBMITTED" as const, submittedAt: now.toISOString(), fee: fee ? toAdminFeeView(fee, now) : null };
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MarkError) {
      return NextResponse.json(e.errors ? { error: e.message, errors: e.errors } : { error: e.message }, { status: e.status });
    }
    throw e;
  }
}
