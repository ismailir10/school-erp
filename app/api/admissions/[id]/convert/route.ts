import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { invalidateParentChildren } from "@/lib/parent-helpers";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { normaliseName, normalisePhone } from "@/lib/parent/match";

const ALREADY_CONVERTED = "Pendaftaran ini sudah dikonversi menjadi siswa.";

// Thrown inside the transaction to abort it with a specific HTTP response.
class ConvertError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type DuplicateAdmission = {
  childName: string;
  dateOfBirth: string | null;
  parentPhone: string | null;
  parentWhatsapp: string | null;
};

/**
 * Students that look like the child being converted: same name (case- and
 * whitespace-insensitive) plus either the same date of birth or a guardian who
 * shares the admission's phone/WhatsApp (or is one of `knownParentIds`).
 * A bare name match is NOT enough — common names repeat across families.
 */
async function findDuplicateStudents(
  tenantId: string,
  admission: DuplicateAdmission,
  knownParentIds: Set<string>,
): Promise<Array<{ id: string; name: string; status: string }>> {
  const name = normaliseName(admission.childName);
  if (!name) return [];
  const candidates = await prisma.student.findMany({
    where: { tenantId, name: { equals: admission.childName.trim(), mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      status: true,
      dateOfBirth: true,
      guardians: { select: { parent: { select: { id: true, phone: true, whatsapp: true } } } },
    },
    take: 20,
  });
  const numbers = new Set(
    [admission.parentPhone, admission.parentWhatsapp]
      .map((n) => (n ? normalisePhone(n) : ""))
      .filter(Boolean),
  );
  return candidates
    .filter((c: (typeof candidates)[number]) => {
      if (normaliseName(c.name) !== name) return false;
      if (admission.dateOfBirth && c.dateOfBirth && admission.dateOfBirth === c.dateOfBirth) return true;
      return c.guardians.some(
        (g: (typeof c.guardians)[number]) =>
          knownParentIds.has(g.parent.id) ||
          [g.parent.phone, g.parent.whatsapp].some((n) => n && numbers.has(normalisePhone(n))),
      );
    })
    .map((c: (typeof candidates)[number]) => ({ id: c.id, name: c.name, status: c.status }));
}

// Convert admission to student record
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // T10: convert flow accepts `mergeWithDetected: boolean` so the admin can
  // override the auto-merge default when sibling-detect flagged a parent.
  // Default true preserves the pre-T10 behaviour (merge when detectedParentId
  // is set). Empty / non-JSON body falls through to the default — convert was
  // historically POST-with-no-body.
  let mergeWithDetected = true;
  // R2-ADMIN-1: the admin has seen the "Kemungkinan siswa/wali ini sudah
  // terdaftar" warning and chose "Tetap konversi".
  let confirmDuplicate = false;
  try {
    const body = await req.json();
    if (body && typeof body.mergeWithDetected === "boolean") {
      mergeWithDetected = body.mergeWithDetected;
    }
    if (body && body.confirmDuplicate === true) confirmDuplicate = true;
  } catch {
    // No body → keep default
  }

  const admission = await prisma.admission.findUnique({ where: { id } });
  if (!admission || admission.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (admission.studentId) {
    console.error(
      `[admin-admissions CONVERT] already converted id=${id} studentId=${admission.studentId}`,
    );
    return NextResponse.json({ error: ALREADY_CONVERTED }, { status: 409 });
  }
  if (admission.status !== "ADMITTED") {
    console.error(
      `[admin-admissions CONVERT] wrong status id=${id} status=${admission.status} (expected ADMITTED)`,
    );
    return NextResponse.json({ error: "Hanya pendaftaran dengan status ADMITTED yang bisa dikonversi" }, { status: 400 });
  }

  // T10 email-conflict gate: when admin chose no-merge AND the admission's
  // parentEmail collides with an existing Parent row (Parent has
  // @@unique([tenantId, email])), fail FAST with 409 + actionable payload
  // before opening the transaction. Without this gate the create path inside
  // the tx would throw P2002 with no recovery info for the UI.
  if (!mergeWithDetected && admission.parentEmail) {
    const parentEmail = admission.parentEmail.trim();
    const conflicting = await prisma.parent.findUnique({
      where: { tenantId_email: { tenantId: session.tenantId, email: parentEmail } },
      select: { id: true, name: true },
    });
    if (conflicting) {
      return NextResponse.json(
        {
          error: "EMAIL_CONFLICT",
          conflictingParentId: conflicting.id,
          conflictingParentName: conflicting.name,
          message:
            "Parent with this email already exists. Use Merge to link, or clear the admission's parent email before retrying.",
        },
        { status: 409 },
      );
    }
  }

  // X-1: sibling detection stamped `detectedParentId` on the admission and the
  // dialog offered "Gabungkan dengan wali". Honour it: link the new Student to
  // THAT Parent (tenant-checked) instead of upserting by email — the detected
  // parent usually has a different email or none, so the email upsert created
  // a second Parent and the family's login never saw the new child. A stale id
  // (parent deleted / other tenant) falls back to the email path below.
  const detectedParent =
    mergeWithDetected && admission.detectedParentId
      ? await prisma.parent.findFirst({
          where: { id: admission.detectedParentId, tenantId: session.tenantId },
          select: { id: true },
        })
      : null;

  // R2-ADMIN-1 duplicate gate. Admin-entered inquiries used to convert straight
  // into a second Student + second Parent for a family already on the books.
  // Look for (a) an existing Student with the same name AND (same date of birth
  // OR a guardian sharing the admission's phone/WhatsApp or the matched
  // parent), and (b) — when no sibling was stamped on the admission and the
  // admin is merging — an existing Parent with the same email/phone/WhatsApp.
  // Either one answers 409 POSSIBLE_DUPLICATE until the body carries
  // confirmDuplicate. A confirmed (b) match is REUSED rather than duplicated.
  // A stamped detectedParent was already confirmed in the merge dialog, so it
  // does not re-trigger the parent half. Runs before the transaction; the
  // FOR UPDATE race guard below is untouched.
  let contactParent: { id: string; name: string } | null = null;
  if (mergeWithDetected && !detectedParent) {
    const match = await detectSibling(
      {
        tenantId: session.tenantId,
        parentEmail: admission.parentEmail,
        parentPhone: admission.parentPhone,
        parentWhatsapp: admission.parentWhatsapp,
      },
      prisma,
    );
    if (match) {
      contactParent = await prisma.parent.findFirst({
        where: { id: match.parentId, tenantId: session.tenantId },
        select: { id: true, name: true },
      });
    }
  }

  const existingStudents = await findDuplicateStudents(
    session.tenantId,
    admission,
    new Set([detectedParent?.id, contactParent?.id].filter((v): v is string => !!v)),
  );

  if ((existingStudents.length > 0 || contactParent) && !confirmDuplicate) {
    return NextResponse.json(
      {
        error: "POSSIBLE_DUPLICATE",
        code: "POSSIBLE_DUPLICATE",
        message:
          "Kemungkinan siswa atau wali ini sudah terdaftar. Periksa dulu sebelum menambah data baru.",
        existingStudents,
        existingParent: contactParent,
      },
      { status: 409 },
    );
  }

  // T11 field-parity audit — every transferable Admission column maps to:
  //   childName            → Student.name
  //   childGender          → Student.gender
  //   dateOfBirth          → Student.dateOfBirth
  //   notes                → Student.notes
  //   parentName/Phone/Email/Whatsapp/Education/Occupation/Income
  //                        → Parent.{name,phone,email,whatsapp,education,
  //                                  occupation,incomeRange}
  //   parentRelationship   → StudentGuardian.relationship
  //   campusPreference     → Student.metadata.campusPreference (stash per
  //                          cycle assumption #3 — convert doesn't auto-
  //                          create an enrollment; a future enroll flow can
  //                          read this hint to default the campus picker)
  // Intentionally NOT transferred (stay on the Admission row for audit):
  //   programId            — Admission keeps program ref; first enroll picks
  //                          ClassSection (carries program transitively)
  //   source / followUpDate / detectedParentId / status / createdAt
  //                        — admission-internal audit
  //   childAge             — legacy free-text, derived from dateOfBirth at
  //                          display time; never written on new admissions
  //                          (see lib/admission/age.ts)
  //
  // STR-1: the studentId/status reads above are outside the transaction, so N
  // parallel converts all pass them. The tx therefore opens by row-locking the
  // admission (FOR UPDATE) and re-reading studentId/status: concurrent converts
  // queue on the lock, and each loser — which sees the winner's committed
  // studentId — aborts with 409 before creating any Student/Parent row.
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const locked = await tx.$queryRaw<Array<{ studentId: string | null; status: string }>>`
      SELECT "studentId", "status" FROM "Admission"
      WHERE "id" = ${id} AND "tenantId" = ${session.tenantId!}
      FOR UPDATE
    `;
    if (locked.length === 0) throw new ConvertError("Pendaftaran tidak ditemukan.", 404);
    if (locked[0].studentId) throw new ConvertError(ALREADY_CONVERTED, 409);
    if (locked[0].status !== "ADMITTED") {
      throw new ConvertError("Hanya pendaftaran dengan status ADMITTED yang bisa dikonversi", 400);
    }

    const studentMetadata = admission.campusPreference
      ? JSON.stringify({ campusPreference: admission.campusPreference })
      : null;
    const student = await tx.student.create({
      data: {
        tenantId: session.tenantId!,
        name: admission.childName,
        dateOfBirth: admission.dateOfBirth,
        gender: admission.childGender,
        notes: admission.notes,
        metadata: studentMetadata,
      },
    });

    const parentEmail = admission.parentEmail?.trim() || null;
    let parent;
    // T10: mergeWithDetected=false forces the create path even when an email
    // could upsert into an existing row. The email-conflict gate above
    // already returned 409 if a Parent with that email exists, so reaching
    // here on the no-merge branch implies the email is unique OR the admin
    // explicitly accepted creating a brand-new parent without email merge.
    if (detectedParent || contactParent) {
      // Existing guardian record stays untouched — the admission's contact
      // details may be a different relative's; only the link is added below.
      parent = (detectedParent ?? contactParent)!;
    } else if (parentEmail && mergeWithDetected) {
      parent = await tx.parent.upsert({
        where: { tenantId_email: { tenantId: session.tenantId!, email: parentEmail } },
        create: {
          tenantId: session.tenantId!,
          name: admission.parentName,
          email: parentEmail,
          phone: admission.parentPhone,
          whatsapp: admission.parentWhatsapp,
          education: admission.parentEducation,
          occupation: admission.parentOccupation,
          incomeRange: admission.parentIncome,
        },
        update: {
          name: admission.parentName,
          phone: admission.parentPhone,
          whatsapp: admission.parentWhatsapp,
          education: admission.parentEducation,
          occupation: admission.parentOccupation,
          incomeRange: admission.parentIncome,
        },
      });
    } else {
      parent = await tx.parent.create({
        data: {
          tenantId: session.tenantId!,
          name: admission.parentName,
          // No-merge branch may still keep the email — uniqueness was
          // verified by the pre-tx gate above.
          email: mergeWithDetected ? null : parentEmail,
          phone: admission.parentPhone,
          whatsapp: admission.parentWhatsapp,
          education: admission.parentEducation,
          occupation: admission.parentOccupation,
          incomeRange: admission.parentIncome,
        },
      });
    }

    await tx.studentGuardian.create({
      data: {
        studentId: student.id,
        parentId: parent.id,
        relationship: admission.parentRelationship || "IBU",
        isPrimary: true,
      },
    });

    await tx.admission.update({
      where: { id },
      data: { studentId: student.id },
    });

    await recordAudit(
      {
        tenantId: session.tenantId!,
        actorId: session.id,
        entity: "Admission",
        entityId: id,
        action: "convert",
        after: { studentId: student.id },
      },
      tx,
    );

    return { student };
  }).catch((e: unknown) => {
    if (e instanceof ConvertError) return e;
    throw e;
  });
  if (result instanceof ConvertError) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  const { student } = result;

  // Guardian link committed; evict the cached parent→children lookup.
  invalidateParentChildren();

  return NextResponse.json({ student, message: "Siswa berhasil dibuat dari data pendaftaran" });
}
