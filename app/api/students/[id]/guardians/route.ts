import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { createGuardianSchema, linkGuardianSchema } from "@/lib/validations/guardian";
import { findParentCandidates } from "@/lib/parent/match";
import { invalidateParentChildren } from "@/lib/parent-helpers";

/**
 * Race-safe single-primary invariant, mirroring the PUT handler in
 * [guardianId]/route.ts. The junction has no unique constraint on
 * (studentId, isPrimary=true), so two concurrent writes could each observe
 * zero primaries and both commit as primary. Serializable isolation lets
 * Postgres abort the loser (P2034); the caller retries once.
 *
 * Applied to both branches of POST. The create branch previously wrote
 * isPrimary straight through, so a client sending isPrimary:true against a
 * student who already had a primary produced two — same hole this closes for
 * the new link branch.
 */
async function writeGuardianAsPrimarySafe<T>(
  studentId: string,
  promotingPrimary: boolean,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const run = () =>
    prisma.$transaction(
      async (tx) => {
        if (promotingPrimary) {
          await tx.studentGuardian.updateMany({
            where: { studentId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        return write(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return await run();
    }
    throw e;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`add-guardian:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: studentId } = await params;

  // Verify student belongs to tenant
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: session.tenantId },
  });
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });

  const raw = await req.json();

  // ── Link an existing parent ──────────────────────────────────────────
  // Presence of parentId selects the link branch: no parent row is created or
  // updated, and any bio fields in the payload are ignored by the schema.
  if (typeof raw?.parentId === "string" && raw.parentId.trim()) {
    const parsedLink = await validateBody(linkGuardianSchema, raw);
    if (parsedLink.error) return parsedLink.error;
    const { parentId, relationship, isPrimary, childOrder } = parsedLink.data;

    // Tenant ownership on the parent, not just the student — without this an
    // admin could link a parent belonging to another school.
    const parent = await prisma.parent.findFirst({
      where: { id: parentId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Wali tidak ditemukan" }, { status: 404 });
    }

    const existing = await prisma.studentGuardian.findUnique({
      where: { studentId_parentId: { studentId, parentId } },
      select: { id: true, status: true },
    });

    if (existing?.status === "ACTIVE") {
      return NextResponse.json(
        { error: "Wali ini sudah tertaut ke siswa tersebut.", code: "GUARDIAN_LINK_EXISTS" },
        { status: 409 }
      );
    }

    const priorGuardianCount = await prisma.studentGuardian.count({
      where: { studentId, status: "ACTIVE" },
    });
    const resolvedIsPrimary = isPrimary ?? priorGuardianCount === 0;

    // An INACTIVE link is reactivated rather than rejected — re-adding a wali
    // who was previously deactivated is unambiguous intent, and the unique
    // constraint on (studentId, parentId) would block a fresh insert anyway.
    if (existing) {
      const reactivated = await writeGuardianAsPrimarySafe(
        studentId,
        resolvedIsPrimary,
        (tx) =>
          tx.studentGuardian.update({
            where: { id: existing.id },
            data: {
              status: "ACTIVE",
              relationship,
              isPrimary: resolvedIsPrimary,
              childOrder: childOrder === undefined ? undefined : childOrder,
            },
            include: { parent: true },
          })
      );
      invalidateParentChildren();
      return NextResponse.json(reactivated, { status: 200 });
    }

    const linked = await writeGuardianAsPrimarySafe(
      studentId,
      resolvedIsPrimary,
      (tx) =>
        tx.studentGuardian.create({
          data: {
            studentId,
            parentId,
            relationship,
            isPrimary: resolvedIsPrimary,
            childOrder: childOrder ?? null,
          },
          include: { parent: true },
        })
    );
    invalidateParentChildren();
    return NextResponse.json(linked, { status: 201 });
  }

  // ── Create a new parent ──────────────────────────────────────────────
  const parsed = await validateBody(createGuardianSchema, raw);
  if (parsed.error) return parsed.error;

  const {
    name, email = null, phone = null, whatsapp = null,
    relationship, isPrimary, confirmNew = false,
    parentNik = null, education = null, occupation = null,
    employer = null, employerAddress = null, employerCity = null, incomeRange = null,
    // T3 data-loss fix: both were parsed but never written — a wali added
    // from "Tambah Wali Baru" silently lost its address and Jumlah Anak.
    // childOrder has no default here (undefined vs explicit null both mean
    // "no position yet"; the junction write below normalises it).
    address = null, childrenTotal = null, childOrder,
  } = parsed.data;

  // Duplicate guard. A parent typed in fresh who already exists under another
  // child produces a second Parent row — two profiles, two KK slots, invoices
  // split across both. Surface the matches and let the admin link instead;
  // confirmNew means they looked and chose to create anyway.
  if (!confirmNew) {
    const candidates = await findParentCandidates(
      { tenantId: session.tenantId, name, email, phone, nik: parentNik },
      prisma
    );
    if (candidates.length) {
      return NextResponse.json(
        {
          error: "Wali dengan data serupa sudah terdaftar.",
          code: "PARENT_CANDIDATES",
          candidates,
        },
        { status: 409 }
      );
    }
  }

  // Validate email doesn't collide with employee/admin
  if (email) {
    const emailCollision = await prisma.employee.findFirst({ where: { email, tenantId: session.tenantId } });
    if (emailCollision) {
      return NextResponse.json({ error: "Email ini sudah digunakan oleh karyawan. Gunakan email lain untuk orang tua." }, { status: 400 });
    }
  }

  // Find or create a Parent record
  let parent;
  if (email) {
    parent = await prisma.parent.upsert({
      where: { tenantId_email: { tenantId: session.tenantId, email } },
      create: { tenantId: session.tenantId, name, email, phone, whatsapp, nik: parentNik, education, occupation, employer, employerAddress, employerCity, incomeRange, address, childrenTotal },
      update: { name, phone, whatsapp, nik: parentNik, education, occupation, employer, employerAddress, employerCity, incomeRange, address, childrenTotal },
    });
  } else {
    parent = await prisma.parent.create({
      data: { tenantId: session.tenantId, name, phone, whatsapp, nik: parentNik, education, occupation, employer, employerAddress, employerCity, incomeRange, address, childrenTotal },
    });
  }

  // FIND-010: auto-default isPrimary=true when this is the student's first
  // active guardian. The Zod schema leaves isPrimary optional and the API
  // owns the default because it needs to count siblings, not a static value.
  const priorGuardianCount = await prisma.studentGuardian.count({
    where: { studentId, status: "ACTIVE" },
  });
  const resolvedIsPrimary = isPrimary ?? priorGuardianCount === 0;

  // Create the StudentGuardian link
  const guardian = await writeGuardianAsPrimarySafe(
    studentId,
    resolvedIsPrimary,
    (tx) =>
      tx.studentGuardian.create({
        data: {
          studentId,
          parentId: parent.id,
          relationship,
          isPrimary: resolvedIsPrimary,
          childOrder: childOrder ?? null,
        },
        include: { parent: true },
      })
  );

  invalidateParentChildren();
  return NextResponse.json(guardian, { status: 201 });
}
