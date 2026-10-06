import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { copyEnrollmentDocsToGuardians } from "@/lib/enrollment/guardian-copy";
import {
  AGAMA_OPTIONS, KEWARGANEGARAAN_OPTIONS, LIVING_WITH_OPTIONS, BIRTH_DELIVERY_OPTIONS,
  BIRTH_TERM_OPTIONS, BLOOD_TYPE_OPTIONS, EDUCATION_OPTIONS, OCCUPATION_OPTIONS, INCOME_OPTIONS,
  type Option,
} from "@/lib/enrollment/constants";

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
 * idempotent (already-converted → 400), ACCEPTED-only. Rich bio/health fields
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
    return NextResponse.json({ error: "Pendaftaran ini sudah dikonversi menjadi siswa" }, { status: 400 });
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
  const { student, ayahId, ibuId } = await prisma.$transaction(async (tx) => {
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
    if (app.admission && !app.admission.studentId) {
      await tx.admission.update({ where: { id: app.admission.id }, data: { studentId: student.id } });
    }

    // Ids of the Parent rows actually linked to the student. An Ibu that
    // resolved to the Ayah's row (shared email) is not a separate guardian.
    return {
      student,
      ayahId: ayah?.id ?? null,
      ibuId: ibu && ibu.id !== ayah?.id ? ibu.id : null,
    };
  });

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
