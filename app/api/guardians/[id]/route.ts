import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { updateGuardianSchema, toggleGuardianStatusSchema } from "@/lib/validations/guardian";
import { changeGuardianLinkStatus, GuardianPrimaryError } from "@/lib/guardians/primary";
import { invalidateParentChildren } from "@/lib/parent-helpers";

/**
 * Standalone guardian routes — operate on a StudentGuardian record by its own ID.
 * Ownership verified via guardian.student.tenantId === session.tenantId.
 *
 * PUT  /api/guardians/[id]  — edit parent contact fields + relationship
 * PATCH /api/guardians/[id] — toggle status (ACTIVE ↔ INACTIVE)
 */

async function findGuardian(id: string, tenantId: string) {
  return prisma.studentGuardian.findFirst({
    where: { id },
    include: { student: { select: { tenantId: true } }, parent: true },
  }).then((g) => (g?.student.tenantId === tenantId ? g : null));
}


export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`guardian-edit:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const guardian = await findGuardian(id, session.tenantId);
  if (!guardian) return NextResponse.json({ error: "Wali tidak ditemukan" }, { status: 404 });

  const body = await req.json();
  const parsed = updateGuardianSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid" }, { status: 400 });
  }

  const d = parsed.data;

  // Update parent contact fields. email is unique per tenant — a concurrent
  // edit or a duplicate entered here can collide (P2002).
  try {
    await prisma.parent.update({
      where: { id: guardian.parentId },
      data: {
        name: d.name?.trim() || guardian.parent.name,
        phone: d.phone !== undefined ? (d.phone?.trim() || null) : guardian.parent.phone,
        email: d.email !== undefined ? (d.email?.trim() || null) : guardian.parent.email,
        whatsapp: d.whatsapp !== undefined ? (d.whatsapp?.trim() || null) : guardian.parent.whatsapp,
        nik: d.parentNik !== undefined ? (d.parentNik?.trim() || null) : undefined,
        education: d.education !== undefined ? (d.education?.trim() || null) : undefined,
        occupation: d.occupation !== undefined ? (d.occupation?.trim() || null) : undefined,
        employer: d.employer !== undefined ? (d.employer?.trim() || null) : undefined,
        employerAddress: d.employerAddress !== undefined ? (d.employerAddress?.trim() || null) : undefined,
        employerCity: d.employerCity !== undefined ? (d.employerCity?.trim() || null) : undefined,
        incomeRange: d.incomeRange !== undefined ? (d.incomeRange?.trim() || null) : undefined,
        address: d.address !== undefined ? (d.address?.trim() || null) : undefined,
        childrenTotal: d.childrenTotal !== undefined ? d.childrenTotal : undefined,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Email sudah digunakan oleh wali lain." },
        { status: 409 },
      );
    }
    throw e;
  }

  // Race-safe single-primary invariant (ported from
  // app/api/students/[id]/guardians/[guardianId]/route.ts T8). The junction
  // has no unique constraint on (studentId, isPrimary=true), so two
  // concurrent promotions could each observe zero primaries and both commit.
  // Serializable isolation lets Postgres abort the loser (P2034); retry once,
  // then surface 409.
  const promotingPrimary = d.isPrimary === true;
  const currentGuardian = guardian;
  const studentId = guardian.studentId;

  async function runPrimaryTx() {
    return prisma.$transaction(
      async (tx) => {
        if (promotingPrimary) {
          await tx.studentGuardian.updateMany({
            where: { studentId, isPrimary: true, id: { not: id } },
            data: { isPrimary: false },
          });
        }
        return tx.studentGuardian.update({
          where: { id },
          data: {
            relationship: d.relationship || currentGuardian.relationship,
            isPrimary: d.isPrimary !== undefined ? d.isPrimary : currentGuardian.isPrimary,
          },
          include: { parent: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  let updated;
  try {
    updated = await runPrimaryTx();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      try {
        updated = await runPrimaryTx();
      } catch (e2) {
        if (e2 instanceof Prisma.PrismaClientKnownRequestError && e2.code === "P2034") {
          return NextResponse.json(
            { error: "Konflik penyimpanan, coba lagi." },
            { status: 409 },
          );
        }
        throw e2;
      }
    } else {
      throw e;
    }
  }

  invalidateParentChildren();
  return NextResponse.json(updated);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`guardian-toggle:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const guardian = await findGuardian(id, session.tenantId);
  if (!guardian) return NextResponse.json({ error: "Wali tidak ditemukan" }, { status: 404 });

  const body = await req.json();
  const parsed = toggleGuardianStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Input tidak valid" }, { status: 400 });
  }
  const newStatus = parsed.data.status;
  const parsedNewPrimaryId = parsed.data.newPrimaryId;

  // CORE-4: keep exactly one ACTIVE primary across the status change.
  try {
    const { link, promoted, noActiveGuardian } = await changeGuardianLinkStatus(prisma, {
      linkId: id,
      studentId: guardian.studentId,
      status: newStatus,
      newPrimaryId: parsedNewPrimaryId,
    });
    invalidateParentChildren();
    return NextResponse.json({ ...link, promotedPrimary: promoted, noActiveGuardian });
  } catch (e) {
    if (e instanceof GuardianPrimaryError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return NextResponse.json({ error: "Konflik penyimpanan, coba lagi." }, { status: 409 });
    }
    throw e;
  }
}
