import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { invalidateParentChildren } from "@/lib/parent-helpers";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { findDuplicateStudents } from "@/lib/admission/duplicate-student";
import { copyEnrollmentDocsToGuardians } from "@/lib/enrollment/guardian-copy";
import {
  namesCompatible, studentFields, validateConvertInput,
  type ConvertMissing, type ParentInput,
} from "@/lib/enrollment/convert-input";

// Admission statuses that still sit before ADMITTED in the pipeline.
const ADMISSION_PRE_ADMIT = new Set(["INQUIRY", "VISIT_SCHEDULED", "VISITED"]);

// A formulir can become a Student from any live stage: still with the parent
// (INVITED, staff filled it in), submitted, legacy "under review", or accepted.
// Only REJECTED is a dead end. The stored status is moved to ACCEPTED on success.
const CONVERTIBLE = new Set(["INVITED", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED"]);

const ALREADY_CONVERTED = "Pendaftaran ini sudah dikonversi menjadi siswa.";
const DUPLICATE_MESSAGE =
  "Sudah ada siswa dengan nama dan data yang mirip. Periksa dulu supaya tidak terdaftar dua kali.";
const LEAD_CLOSED = "Pertanyaan ini sudah dibatalkan, jadi formulirnya belum bisa dijadikan siswa.";
const GUARDIAN_RACE = "Wali dengan email yang sama baru saja dibuat. Coba lagi.";
const GUARDIAN_MISMATCH =
  "Email wali ini sudah terdaftar atas nama yang berbeda. Periksa dulu supaya anak tidak masuk ke akun orang lain.";

// Optional body. Only a literal `true` confirms; anything else is ignored.
const convertBodySchema = z.object({
  confirmDuplicate: z.literal(true).optional(),
  confirmGuardians: z.literal(true).optional(),
});

function statusError(status: string): string {
  return status === "REJECTED"
    ? "Formulir ini sudah ditolak, jadi belum bisa dijadikan siswa. Kembalikan statusnya dulu kalau ingin melanjutkan."
    : "Status formulir ini belum bisa dijadikan siswa.";
}

// Thrown inside the transaction to abort it with a specific HTTP response.
class ConvertError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly opts: { code?: string; errors?: ConvertMissing[]; extra?: Record<string, unknown> } = {},
  ) {
    super(message);
  }
}

function errorResponse(e: ConvertError) {
  return NextResponse.json(
    {
      error: e.message,
      ...(e.opts.code ? { code: e.opts.code } : {}),
      ...(e.opts.errors ? { errors: e.opts.errors } : {}),
      ...e.opts.extra,
    },
    { status: e.status },
  );
}

type Role = "AYAH" | "IBU";
type ReusedGuardian = { role: Role; name: string; otherChildrenCount: number };
type ExistingParent = {
  id: string; name: string; phone: string | null; education: string | null; occupation: string | null;
  incomeRange: string | null; address: string | null; employer: string | null; employerAddress: string | null;
};
// What to do for one parent block, decided from reads only (before any write).
type GuardianPlan =
  | { kind: "create"; role: Role; input: ParentInput }
  | { kind: "same"; role: Role } // resolves to the row the earlier block already uses
  | { kind: "reuse"; role: Role; input: ParentInput; row: ExistingParent; compatible: boolean; otherChildrenCount: number };

const blank = (v: string | null | undefined) => !v || !v.trim();
const sameEmail = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * POST /api/enrollments/[id]/convert — the ONE convert. Promotes an application
 * into a Student + Ayah Parent + Ibu Parent + StudentGuardian links (AYAH
 * primary) and links the originating lead. Admin-gated (`admissions.edit`),
 * tenant-scoped, single-winner (already-converted -> 409 ALREADY_CONVERTED).
 *
 * Preconditions: not converted, lead not CANCELLED (409 LEAD_CLOSED), not
 * REJECTED (400 NOT_CONVERTIBLE), and enough data to create valid rows: a child
 * name and a name for Ayah or Ibu. Anything missing comes back as the repo 400
 * `{ error:"Validasi gagal", errors:[{field,message}] }`, checked again on the
 * row-locked copy. An unpaid pendaftaran fee never blocks (A3). On success the
 * application is stored as ACCEPTED, whatever stage it was in.
 *
 * Optional body `{ confirmDuplicate?: true, confirmGuardians?: true }`.
 * - A student with the same name and the same birth date or a shared guardian
 *   contact answers 409 POSSIBLE_DUPLICATE with `candidates` until confirmed.
 * - An email that belongs to an existing wali under an incompatible name answers
 *   409 GUARDIAN_NAME_MISMATCH with `guardians` until confirmed; confirmed, the
 *   child is linked to that wali but none of its blank fields are filled.
 *
 * Wali: a block matching an existing Parent by email (or by phone when the block
 * has no email AND the names are compatible) is REUSED and linked, which is the
 * normal sibling case. Its existing values are never overwritten, only blank
 * fields are filled; the response lists them in `reusedGuardians`. A Parent
 * resolved by an earlier block of the same convert is never matched by phone
 * (a shared family phone must not collapse Ibu into Ayah).
 *
 * Rich bio/health fields with no first-class Student column are stashed in
 * Student.metadata JSON.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const limit = rateLimit(`enrollment-convert:${session.id}`, 30, 60_000);
  if (!limit.success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;

  // The body is optional: no body (or an invalid one) means no confirmation.
  const parsedBody = convertBodySchema.safeParse(await req.json().catch(() => null));
  const confirmDuplicate = parsedBody.success && parsedBody.data.confirmDuplicate === true;
  const confirmGuardians = parsedBody.success && parsedBody.data.confirmGuardians === true;

  const app = await prisma.enrollmentApplication.findUnique({
    where: { id },
    include: { admission: { select: { id: true, studentId: true, status: true } } },
  });
  if (!app || app.tenantId !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (app.studentId) {
    return errorResponse(new ConvertError(ALREADY_CONVERTED, 409, { code: "ALREADY_CONVERTED" }));
  }
  if (app.admission?.status === "CANCELLED") {
    return errorResponse(new ConvertError(LEAD_CLOSED, 409, { code: "LEAD_CLOSED" }));
  }
  if (!CONVERTIBLE.has(app.status)) {
    return errorResponse(new ConvertError(statusError(app.status), 400, { code: "NOT_CONVERTIBLE" }));
  }

  const early = validateConvertInput(app);
  if (!early.ok) {
    return NextResponse.json({ error: "Validasi gagal", errors: early.errors }, { status: 400 });
  }

  if (!confirmDuplicate) {
    const candidates = await findDuplicateStudents(tenantId, {
      childName: early.input.childName,
      dateOfBirth: early.input.dateOfBirth,
      phones: [early.input.ayah?.phone, early.input.ibu?.phone],
      emails: [early.input.ayah?.email, early.input.ibu?.email],
    });
    if (candidates.length > 0) {
      return NextResponse.json(
        { error: DUPLICATE_MESSAGE, code: "POSSIBLE_DUPLICATE", candidates },
        { status: 409 },
      );
    }
  }

  // Parent rows are resolved inside the tx (sibling-detect reads + tx writes).
  //
  // STR-1: the studentId/status reads above are outside the transaction, so N
  // parallel converts all pass them. The tx therefore opens by row-locking the
  // application (FOR UPDATE) and re-reading studentId/status and the data
  // blobs: concurrent converts queue on the lock, and each loser — which sees
  // the winner's committed studentId — aborts with 409 before creating any
  // Student/Parent. Everything is then built from the locked copy, so a staff
  // edit that landed after the first read is never converted from stale data.
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<
      Array<{
        studentId: string | null;
        status: string;
        childName: string | null;
        studentData: unknown;
        ayahData: unknown;
        ibuData: unknown;
        dcareAddon: boolean;
      }>
    >`
      SELECT "studentId", "status", "childName", "studentData", "ayahData", "ibuData", "dcareAddon"
      FROM "EnrollmentApplication"
      WHERE "id" = ${id} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (locked.length === 0) throw new ConvertError("Not found", 404);
    const row = locked[0];
    if (row.studentId) throw new ConvertError(ALREADY_CONVERTED, 409, { code: "ALREADY_CONVERTED" });
    if (!CONVERTIBLE.has(row.status)) {
      throw new ConvertError(statusError(row.status), 400, { code: "NOT_CONVERTIBLE" });
    }
    const checked = validateConvertInput(row);
    if (!checked.ok) throw new ConvertError("Validasi gagal", 400, { errors: checked.errors });
    const input = checked.input;

    const fields = studentFields(input, { dcareAddon: row.dcareAddon, applicationId: id });

    // ── Plan the guardians from reads only, so a refusal happens before any write.
    async function planGuardian(role: Role, p: ParentInput, prior: GuardianPlan | null): Promise<GuardianPlan> {
      const priorEmail = prior?.kind === "create" || prior?.kind === "reuse" ? prior.input.email : null;
      const priorRowId = prior?.kind === "reuse" ? prior.row.id : null;
      const toReuse = async (existing: ExistingParent, compatible: boolean): Promise<GuardianPlan> => ({
        kind: "reuse",
        role,
        input: p,
        row: existing,
        compatible,
        otherChildrenCount: await tx.studentGuardian.count({
          where: { parentId: existing.id, status: "ACTIVE", student: { tenantId } },
        }),
      });

      if (p.email) {
        // The earlier block carries the very same email: one wali row for both.
        if (sameEmail(priorEmail, p.email)) return { kind: "same", role };
        const rows = await tx.parent.findMany({
          where: { tenantId, email: { equals: p.email, mode: "insensitive" } },
          orderBy: { createdAt: "asc" },
        });
        const active = rows.find((r: (typeof rows)[number]) => r.status === "ACTIVE");
        if (!active && rows.length > 0) {
          throw new ConvertError(
            `Email ${role === "AYAH" ? "Ayah" : "Ibu"} sudah terdaftar pada wali yang nonaktif. Aktifkan lagi wali tersebut, atau perbaiki emailnya lewat Ubah data.`,
            409,
            { code: "GUARDIAN_INACTIVE" },
          );
        }
        if (active) {
          if (active.id === priorRowId) return { kind: "same", role };
          return toReuse(active, namesCompatible(p.name, active.name));
        }
        return { kind: "create", role, input: p };
      }

      // No email: a phone match counts only for a compatible name, and never
      // for the row an earlier block of this convert already uses (shared
      // family phone). Phone is not unique, so otherwise a new wali is created.
      const match = p.phone ? await detectSibling({ tenantId, parentEmail: undefined, parentPhone: p.phone }, tx) : null;
      if (match && match.parentId !== priorRowId) {
        const existing = await tx.parent.findFirst({ where: { id: match.parentId, tenantId } });
        if (existing && namesCompatible(p.name, existing.name)) return toReuse(existing, true);
      }
      return { kind: "create", role, input: p };
    }

    const ayahPlan = input.ayah ? await planGuardian("AYAH", input.ayah, null) : null;
    const ibuPlan = input.ibu ? await planGuardian("IBU", input.ibu, ayahPlan) : null;
    const plans = [ayahPlan, ibuPlan].filter((x): x is GuardianPlan => !!x);

    // An email that belongs to a wali under another name: ask before linking.
    const mismatches = plans.flatMap((pl) =>
      pl.kind === "reuse" && !pl.compatible
        ? [{ role: pl.role, formName: pl.input.name, existingName: pl.row.name, otherChildrenCount: pl.otherChildrenCount }]
        : [],
    );
    if (mismatches.length > 0 && !confirmGuardians) {
      throw new ConvertError(GUARDIAN_MISMATCH, 409, { code: "GUARDIAN_NAME_MISMATCH", extra: { guardians: mismatches } });
    }

    // ── Writes.
    const student = await tx.student.create({
      data: {
        tenantId,
        name: input.childName,
        nickname: fields.nickname,
        dateOfBirth: fields.dateOfBirth,
        gender: fields.gender,
        birthPlace: fields.birthPlace,
        address: fields.address,
        livingWith: fields.livingWith,
        metadata: fields.metadata,
      },
    });

    // Returns the Parent row to link (null for "same as the earlier block").
    async function applyPlan(pl: GuardianPlan): Promise<{ id: string; reused: ReusedGuardian | null } | null> {
      if (pl.kind === "same") return null;
      const p = pl.input;
      if (pl.kind === "create") {
        try {
          const created = await tx.parent.create({
            data: {
              tenantId, name: p.name, email: p.email, phone: p.phone, education: p.education,
              occupation: p.occupation, incomeRange: p.incomeRange, address: p.address,
              employer: p.employer, employerAddress: p.employerAddress,
            },
          });
          return { id: created.id, reused: null };
        } catch (e) {
          // Two converts racing on the same new email: the unique index is the arbiter.
          if ((e as { code?: string })?.code === "P2002") {
            throw new ConvertError(GUARDIAN_RACE, 409, { code: "GUARDIAN_RACE" });
          }
          throw e;
        }
      }

      // Never overwrite what the family record already holds; fill gaps only,
      // and not at all on a wali the staff confirmed despite a name mismatch.
      if (pl.compatible) {
        const e = pl.row;
        const fill: Prisma.ParentUpdateInput = {};
        if (blank(e.phone) && p.phone) fill.phone = p.phone;
        if (blank(e.education) && p.education) fill.education = p.education;
        if (blank(e.occupation) && p.occupation) fill.occupation = p.occupation;
        if (blank(e.incomeRange) && p.incomeRange) fill.incomeRange = p.incomeRange;
        if (blank(e.address) && p.address) fill.address = p.address;
        if (blank(e.employer) && p.employer) fill.employer = p.employer;
        if (blank(e.employerAddress) && p.employerAddress) fill.employerAddress = p.employerAddress;
        if (Object.keys(fill).length > 0) {
          await tx.parent.update({ where: { id: e.id }, data: fill });
        }
      }
      return {
        id: pl.row.id,
        reused: { role: pl.role, name: pl.row.name, otherChildrenCount: pl.otherChildrenCount },
      };
    }

    const ayah = ayahPlan ? await applyPlan(ayahPlan) : null;
    const ibuApplied = ibuPlan ? await applyPlan(ibuPlan) : null;
    // An Ibu that resolved to the Ayah's row ("same", or the same reused row)
    // is not a separate guardian: @@unique([studentId,parentId]) would throw.
    const ibu = ibuApplied && ibuApplied.id !== ayah?.id ? ibuApplied : null;

    if (ayah) {
      await tx.studentGuardian.create({
        data: { studentId: student.id, parentId: ayah.id, relationship: "AYAH", isPrimary: true, childOrder: fields.childOrder },
      });
    }
    if (ibu) {
      await tx.studentGuardian.create({
        data: { studentId: student.id, parentId: ibu.id, relationship: "IBU", isPrimary: !ayah, childOrder: fields.childOrder },
      });
    }

    // The stored stage follows the outcome: a converted application is ACCEPTED
    // even when staff converted straight from INVITED / SUBMITTED.
    await tx.enrollmentApplication.update({
      where: { id },
      data: row.status === "ACCEPTED" ? { studentId: student.id } : { studentId: student.id, status: "ACCEPTED" },
    });
    // Link the originating inquiry too so it reads as converted (only if free).
    // Lock + re-read: another writer may have linked it since the pre-tx read,
    // and an unconditional update would overwrite that.
    if (app.admission) {
      const adm = await tx.$queryRaw<Array<{ studentId: string | null; status: string }>>`
        SELECT "studentId", "status" FROM "Admission"
        WHERE "id" = ${app.admission.id} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      if (adm.length > 0 && !adm[0].studentId) {
        // ADM-6: a converted application means the family is admitted — move
        // an early-pipeline inquiry to ADMITTED so the funnel doesn't leave a
        // converted child stuck at INQUIRY. ADMITTED/CANCELLED never regress.
        const advance = ADMISSION_PRE_ADMIT.has(adm[0].status);
        await tx.admission.update({
          where: { id: app.admission.id, tenantId },
          data: advance ? { studentId: student.id, status: "ADMITTED" } : { studentId: student.id },
        });
      }
    }

    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "EnrollmentApplication",
        entityId: id,
        action: "convert",
        after: { studentId: student.id, fromStatus: row.status },
      },
      tx,
    );

    return {
      student,
      ayahId: ayah?.id ?? null,
      ibuId: ibu?.id ?? null,
      reusedGuardians: [ayah?.reused, ibu?.reused].filter((r): r is ReusedGuardian => !!r),
    };
  }).catch((e: unknown) => {
    if (e instanceof ConvertError) return e;
    throw e;
  });
  if (result instanceof ConvertError) return errorResponse(result);
  const { student, ayahId, ibuId, reusedGuardians } = result;

  // Guardians were linked inside the committed transaction; evict the cached
  // parent→children lookup so the family sees the new child right away.
  invalidateParentChildren();

  // After commit, best-effort: give each guardian their own copy of the KTP/KK
  // the parent uploaded. Never throws and never overwrites an existing document,
  // so a storage hiccup cannot undo a conversion that already succeeded.
  const documentsCopied = await copyEnrollmentDocsToGuardians({
    tenantId,
    applicationDocuments: app.documents,
    ayahId,
    ibuId,
  });

  return NextResponse.json({
    student,
    message: "Siswa berhasil dibuat dari formulir pendaftaran",
    documentsCopied,
    reusedGuardians,
  });
}
