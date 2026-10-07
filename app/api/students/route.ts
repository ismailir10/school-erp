import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { parsePagination, parseSort } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createStudentSchema } from "@/lib/validations/student";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { findStudentConflict } from "@/lib/students/guards";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["name", "nickname", "nis", "createdAt", "status", "dateOfBirth"],
    default: "name",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { nickname: { contains: search, mode: "insensitive" } },
      // NIS too: homonyms are told apart by their number (CORE-3 picker).
      { nis: { contains: search, mode: "insensitive" } },
    ];
  }
  // Class "Tambah Siswa" picker: leave out students already ACTIVE in that
  // class server-side, so the paged result never hides an eligible student
  // behind an already-enrolled one (CORE-3).
  const notEnrolledInClass = searchParams.get("notEnrolledInClass");
  if (notEnrolledInClass) {
    where.enrollments = { none: { classSectionId: notEnrolledInClass, status: "ACTIVE" } };
  }

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      skip,
      take,
      include: {
        guardians: {
          // Was `where: { isPrimary: true }`, which printed "—" for any
          // student whose guardians exist but none carries the flag — the
          // common shape for rows imported in bulk. Fall back to the first
          // ACTIVE guardian instead, preferring the primary.
          where: { status: "ACTIVE" },
          orderBy: { isPrimary: "desc" },
          take: 1,
          // phone exposed intentionally: admin-only route (isAdminRole guard above), used for quick-contact in student list.
          // id is needed for the list's link through to the guardian page.
          include: { parent: { select: { id: true, name: true, phone: true } } },
        },
        enrollments: {
          where: {
            status: "ACTIVE",
            // Exclude ARCHIVED-year rows. Un-closed prior-year ACTIVE
            // enrollments (bulk-import artifact — see T9 regression,
            // docs/cycles/2026-08-21-enrollment-flexibility.md) would
            // otherwise show up in the "Kelas" column alongside the real
            // current-year row.
            classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
          },
          include: {
            classSection: { select: { name: true, program: { select: { name: true, type: true } } } },
          },
          // No `take: 1` — a student may hold one SEMESTER (sekolah) and one
          // YEAR_ROUND (daycare) enrolment at once; the "Kelas" column shows
          // both, ordered primary-first via `pickPrimaryEnrollment`. `orderBy`
          // stays for determinism when a stale ARCHIVED-year row is also
          // ACTIVE (matches the detail route's `createdAt desc`).
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy,
    }),
    prisma.student.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(students, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-student:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rawBody = await req.json();
  const result = await validateBody(createStudentSchema, rawBody);
  if (result.error) return result.error;
  const body = result.data;
  // Not part of createStudentSchema (lib/validations is out of scope here), so
  // read it off the raw JSON: "Tetap simpan" re-POSTs with it set (ADM-2).
  const confirmDuplicate =
    typeof rawBody === "object" && rawBody !== null && (rawBody as Record<string, unknown>).confirmDuplicate === true;

  const conflict = await findStudentConflict({
    tenantId: session.tenantId,
    nis: body.nis,
    name: body.name,
    dateOfBirth: body.dateOfBirth,
    skipDuplicateName: confirmDuplicate,
  });
  if (conflict) return conflict;

  // Enforce the single-primary-guardian invariant BEFORE creating anything.
  // createMany below writes isPrimary straight from client input with no DB
  // constraint backing it — a client sending two `isPrimary: true` guardians
  // would otherwise persist two primaries for the same student.
  const guardians = body.guardians ?? [];
  const primaryCount = guardians.filter((g) => g.isPrimary).length;
  if (primaryCount > 1) {
    return NextResponse.json(
      { error: "Hanya satu wali utama yang diperbolehkan." },
      { status: 400 },
    );
  }
  // Normalize: if none flagged primary but guardians exist, index 0 wins.
  const normalizedIsPrimary = guardians.map((g, i) =>
    primaryCount === 1 ? g.isPrimary === true : i === 0,
  );

  // Guardian email must not collide with an existing employee account
  // (mirrors app/api/students/[id]/guardians/route.ts's per-add check).
  if (guardians.length) {
    const emails = Array.from(
      new Set(
        guardians
          .map((g) => g.email?.trim())
          .filter((e): e is string => !!e),
      ),
    );
    if (emails.length) {
      const emailCollision = await prisma.employee.findFirst({
        where: { email: { in: emails }, tenantId: session.tenantId },
      });
      if (emailCollision) {
        return NextResponse.json(
          { error: "Email ini sudah digunakan oleh karyawan. Gunakan email lain untuk orang tua." },
          { status: 400 },
        );
      }
    }
  }

  const student = await prisma.student.create({
    data: {
      tenantId: session.tenantId,
      name: body.name,
      nickname: body.nickname ?? null,
      dateOfBirth: body.dateOfBirth ?? null,
      gender: body.gender ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      nis: body.nis?.trim() || null,
      nisn: body.nisn?.trim() || null,
      birthPlace: body.birthPlace?.trim() || null,
      nik: body.nik?.trim() || null,
      kkNumber: body.kkNumber?.trim() || null,
      livingWith: body.livingWith?.trim() || null,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      status: body.status ?? "ACTIVE",
    },
  });

  if (body.guardians?.length) {
    const tenantId = session.tenantId;
    // Resolve every parent row in parallel — upsert when email present so we
    // dedupe against existing parents, plain create when no email is supplied.
    const parents = await Promise.all(
      body.guardians.map((g) => {
        const email = g.email?.trim() || null;
        if (email) {
          return prisma.parent.upsert({
            where: { tenantId_email: { tenantId, email } },
            create: { tenantId, name: g.name, email, phone: g.phone ?? null, whatsapp: g.whatsapp ?? null },
            update: { name: g.name, phone: g.phone ?? null, whatsapp: g.whatsapp ?? null },
          });
        }
        return prisma.parent.create({
          data: { tenantId, name: g.name, phone: g.phone ?? null, whatsapp: g.whatsapp ?? null },
        });
      }),
    );
    // Insert all StudentGuardian links in a single round-trip. isPrimary
    // comes from the normalized array above, not client input directly.
    await prisma.studentGuardian.createMany({
      data: body.guardians.map((g, i) => ({
        studentId: student.id,
        parentId: parents[i].id,
        relationship: g.relationship,
        isPrimary: normalizedIsPrimary[i],
      })),
    });
  }

  return NextResponse.json(student, { status: 201 });
}
