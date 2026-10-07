import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { copyEnrollmentDocsToGuardians } from "@/lib/enrollment/guardian-copy";
import {
  AGAMA_OPTIONS, KEWARGANEGARAAN_OPTIONS, LIVING_WITH_OPTIONS, BIRTH_DELIVERY_OPTIONS,
  BIRTH_TERM_OPTIONS, BLOOD_TYPE_OPTIONS, EDUCATION_OPTIONS, OCCUPATION_OPTIONS, INCOME_OPTIONS,
  type Option,
} from "@/lib/enrollment/constants";

const ALREADY_CONVERTED = "Pendaftaran ini sudah dikonversi menjadi siswa.";

// Thrown inside the transaction to abort it with a specific HTTP response.
class ConvertError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Json = Record<string, unknown>;
const j = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const label = (opts: Option[], v: unknown): string | null => {
  const val = s(v);
  return val ? (opts.find((o) => o.value === val)?.label ?? val) : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

type ParentInput = {
  name: string;
  email: string | null;
  phone: string | null;
  education: string | null;
  occupation: string | null;
  incomeRange: string | null;
  address: string | null;
  employer: string | null;
  employerAddress: string | null;
};

function parentFrom(block: unknown): ParentInput | null {
  const b = j(block);
  const name = s(b.name);
  if (!name) return null;
  const a = j(b.address);
  const address = [s(a.perumahan), s(a.blokCluster), s(a.rtRw), s(a.kecamatan), s(a.kodePos)]
    .filter(Boolean)
    .join(", ") || null;
  return {
    name,
    email: s(b.email),
    phone: s(b.phone),
    education: label(EDUCATION_OPTIONS, b.education),
    occupation: label(OCCUPATION_OPTIONS, b.occupation),
    incomeRange: label(INCOME_OPTIONS, b.income),
    address,
    employer: s(b.employerName),
    employerAddress: s(b.employerAddress),
  };
}

/**
 * POST /api/enrollments/[id]/convert — promote an ACCEPTED application into a
 * Student + Ayah Parent + Ibu Parent + StudentGuardian links (AYAH primary).
 * Mirrors app/api/admissions/[id]/convert: admin-gated, tenant-scoped,
 * single-winner (already-converted → 409), ACCEPTED-only. Rich bio/health fields
 * with no first-class Student column are stashed in Student.metadata JSON.
 *
 * Parent reuse: a block with an email upserts by (tenantId,email) — merging
 * into an existing family row; an email-less block runs sibling-detect on the
 * phone and links to a match, else creates fresh. Both reuse lib/admission.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  const { id } = await params;

  const app = await prisma.enrollmentApplication.findUnique({
    where: { id },
    include: { admission: { select: { id: true, studentId: true } } },
  });
  if (!app || app.tenantId !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (app.studentId) {
    return NextResponse.json({ error: ALREADY_CONVERTED }, { status: 409 });
  }
  if (app.status !== "ACCEPTED") {
    return NextResponse.json(
      { error: "Hanya formulir dengan status Diterima yang bisa dikonversi" },
      { status: 400 },
    );
  }

  const sd = j(app.studentData);
  const ayahIn = parentFrom(app.ayahData);
  const ibuIn = parentFrom(app.ibuData);

  // Student metadata: everything without a first-class column.
  const addr = j(sd.address);
  const metadata: Json = {
    religion: label(AGAMA_OPTIONS, sd.agama),
    citizenship: label(KEWARGANEGARAAN_OPTIONS, sd.kewarganegaraan),
    bloodType: label(BLOOD_TYPE_OPTIONS, sd.bloodType),
    birthDelivery: label(BIRTH_DELIVERY_OPTIONS, sd.birthDelivery),
    birthTerm: label(BIRTH_TERM_OPTIONS, sd.birthTerm),
    homeLanguage: s(sd.homeLanguage),
    foodAllergy: s(sd.foodAllergy),
    seriousIllness: s(sd.seriousIllness),
    weightKg: num(sd.weightKg),
    heightCm: num(sd.heightCm),
    headCircumferenceCm: num(sd.headCircumferenceCm),
    siblingsKandung: num(sd.siblingsKandung),
    siblingsTiri: num(sd.siblingsTiri),
    siblingsAngkat: num(sd.siblingsAngkat),
    dcareAddon: app.dcareAddon,
    priorFamilyAttendees: Array.isArray(sd.priorFamilyAttendees) ? sd.priorFamilyAttendees : [],
    fromEnrollmentApplication: app.id,
  };

  const studentAddress =
    [s(addr.perumahan), s(addr.blokCluster), s(addr.rtRw), s(addr.kecamatan), s(addr.kodePos)]
      .filter(Boolean)
      .join(", ") || null;
  const childOrder = num(sd.childOrder);

  // Resolve each parent to an existing or new Parent row OUTSIDE the tx is
  // unsafe (sibling-detect reads + tx writes); do it all inside the tx.
  //
  // STR-1: the studentId/status reads above are outside the transaction, so N
  // parallel converts all pass them. The tx therefore opens by row-locking the
  // application (FOR UPDATE) and re-reading studentId/status: concurrent
  // converts queue on the lock, and each loser — which sees the winner's
  // committed studentId — aborts with 409 before creating any Student/Parent.
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<Array<{ studentId: string | null; status: string }>>`
      SELECT "studentId", "status" FROM "EnrollmentApplication"
      WHERE "id" = ${id} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (locked.length === 0) throw new ConvertError("Not found", 404);
    if (locked[0].studentId) throw new ConvertError(ALREADY_CONVERTED, 409);
    if (locked[0].status !== "ACCEPTED") {
      throw new ConvertError("Hanya formulir dengan status Diterima yang bisa dikonversi", 400);
    }

    async function resolveParent(p: ParentInput) {
      if (p.email) {
        return tx.parent.upsert({
          where: { tenantId_email: { tenantId, email: p.email } },
          create: { tenantId, name: p.name, email: p.email, phone: p.phone, education: p.education, occupation: p.occupation, incomeRange: p.incomeRange, address: p.address, employer: p.employer, employerAddress: p.employerAddress },
          update: { name: p.name, phone: p.phone, education: p.education, occupation: p.occupation, incomeRange: p.incomeRange, address: p.address, employer: p.employer, employerAddress: p.employerAddress },
        });
      }
      const match = await detectSibling({ tenantId, parentEmail: undefined, parentPhone: p.phone ?? undefined }, tx);
      if (match) {
        return tx.parent.update({ where: { id: match.parentId }, data: { name: p.name, education: p.education, occupation: p.occupation, incomeRange: p.incomeRange, address: p.address, employer: p.employer, employerAddress: p.employerAddress } });
      }
      return tx.parent.create({ data: { tenantId, name: p.name, phone: p.phone, education: p.education, occupation: p.occupation, incomeRange: p.incomeRange, address: p.address, employer: p.employer, employerAddress: p.employerAddress } });
    }

    const student = await tx.student.create({
      data: {
        tenantId,
        name: app.childName,
        nickname: s(sd.nickname),
        dateOfBirth: s(sd.dateOfBirth),
        gender: s(sd.childGender),
        birthPlace: s(sd.birthPlace),
        address: studentAddress,
        livingWith: label(LIVING_WITH_OPTIONS, sd.livingWith),
        metadata: JSON.stringify(metadata),
      },
    });

    const ayah = ayahIn ? await resolveParent(ayahIn) : null;
    const ibu = ibuIn ? await resolveParent(ibuIn) : null;

    if (ayah) {
      await tx.studentGuardian.create({
        data: { studentId: student.id, parentId: ayah.id, relationship: "AYAH", isPrimary: true, childOrder },
      });
    }
    // Skip the Ibu guardian if she resolved to the same Parent row as Ayah
    // (data error: shared email) — @@unique([studentId,parentId]) would throw.
    if (ibu && ibu.id !== ayah?.id) {
      await tx.studentGuardian.create({
        data: { studentId: student.id, parentId: ibu.id, relationship: "IBU", isPrimary: !ayah, childOrder },
      });
    }

    await tx.enrollmentApplication.update({ where: { id }, data: { studentId: student.id } });
    // Link the originating inquiry too so it reads as converted (only if free).
    // Lock + re-read: the admission's own convert route may have linked it
    // since the pre-tx read, and an unconditional update would overwrite that.
    if (app.admission) {
      const adm = await tx.$queryRaw<Array<{ studentId: string | null }>>`
        SELECT "studentId" FROM "Admission" WHERE "id" = ${app.admission.id} FOR UPDATE
      `;
      if (adm.length > 0 && !adm[0].studentId) {
        await tx.admission.update({ where: { id: app.admission.id }, data: { studentId: student.id } });
      }
    }

    // Ids of the Parent rows actually linked to the student. An Ibu that
    // resolved to the Ayah's row (shared email) is not a separate guardian.
    return {
      student,
      ayahId: ayah?.id ?? null,
      ibuId: ibu && ibu.id !== ayah?.id ? ibu.id : null,
    };
  }).catch((e: unknown) => {
    if (e instanceof ConvertError) return e;
    throw e;
  });
  if (result instanceof ConvertError) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  const { student, ayahId, ibuId } = result;

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
  });
}
