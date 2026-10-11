import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { createAdmissionSchema } from "@/lib/validations/admission";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { hasPermission } from "@/lib/permissions";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { recordAudit } from "@/lib/audit";
import { programInTenant, PROGRAM_NOT_FOUND } from "@/lib/admission/program-scope";

export async function GET(req: NextRequest) {
  const session = await getSession();
  // HR-16: anonymous callers get a real 401, not an empty 200.
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["createdAt", "childName", "parentName", "status", "followUpDate"],
    default: "createdAt",
    defaultOrder: "desc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;
  const status = searchParams.get("status");
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { childName: { contains: search, mode: "insensitive" } },
      { parentName: { contains: search, mode: "insensitive" } },
      { parentPhone: { contains: search, mode: "insensitive" } },
    ];
  }

  const [admissions, total] = await Promise.all([
    prisma.admission.findMany({
      where,
      skip,
      take,
      include: {
        program: { select: { name: true } },
        detectedParent: {
          select: {
            id: true,
            name: true,
            guardians: {
              where: { status: "ACTIVE" },
              select: { student: { select: { name: true } } },
            },
          },
        },
      },
      orderBy,
    }),
    prisma.admission.count({ where }),
  ]);

  return NextResponse.json({
    ...paginatedResponse(admissions, total, page, pageSize),
    canEdit: hasPermission(session, "admissions.edit"),
  });
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-admission:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  // An unreadable body is a validation failure (400), not a thrown 500.
  const parsed = createAdmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Log issues so Vercel runtime logs surface the actual reason (issues
    // array) — request bodies are not captured by default; this is what
    // makes admin 400s diagnosable without DevTools. Mirrors PUT route shape.
    console.error(
      "[admin-admissions POST] validation failed",
      JSON.stringify(parsed.error.issues),
    );
    const errors = parsed.error.issues.map((e) => ({ field: e.path.join("."), message: e.message }));
    return NextResponse.json({ error: "Validasi gagal", errors }, { status: 400 });
  }
  const body = parsed.data;

  if (body.programId && !(await programInTenant(tenantId, body.programId))) {
    return NextResponse.json(
      { error: "Validasi gagal", errors: [{ field: "programId", message: PROGRAM_NOT_FOUND }] },
      { status: 400 },
    );
  }

  // Create + audit commit together: a lead written without its audit row is
  // not allowed (recordAudit re-throws inside a transaction).
  const admission = await prisma.$transaction(async (tx) => {
    const created = await tx.admission.create({
      data: {
        tenantId,
        // The column is NOT NULL; an absent child name is stored as "" and shown as "Belum diisi".
        childName: body.childName?.trim() ?? "",
        // childAge is auto-derived at display time from dateOfBirth — never written.
        childGender: body.childGender || null,
        dateOfBirth: body.dateOfBirth || null,
        parentName: body.parentName.trim(),
        parentPhone: body.parentPhone?.trim() || null,
        parentEmail: body.parentEmail?.trim() || null,
        parentWhatsapp: body.parentWhatsapp?.trim() || null,
        parentRelationship: body.parentRelationship || null,
        programId: body.programId || null,
        // Staff-created leads are always WALK_IN; a `source` in the body is ignored (public /daftar sets WEBSITE).
        source: "WALK_IN",
        notes: body.notes?.trim() || null,
      },
    });
    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "Admission",
        entityId: created.id,
        action: "create",
        after: { source: "WALK_IN", status: created.status },
      },
      tx,
    );
    return created;
  });

  // R2-ADMIN-1: same sibling auto-detect as the public /daftar submit. Without
  // it an admin-entered inquiry never got a "Saudara terdeteksi" chip and
  // converting it silently created a second Parent. Matches email, phone or
  // WhatsApp. Failure is swallowed — the admission is already created, so the
  // 201 stays authoritative and convert still re-checks for duplicates.
  try {
    const match = await detectSibling(
      {
        tenantId,
        parentEmail: admission.parentEmail,
        parentPhone: admission.parentPhone,
        parentWhatsapp: admission.parentWhatsapp,
      },
      prisma,
    );
    if (match) {
      await prisma.admission.update({
        where: { id: admission.id },
        data: { detectedParentId: match.parentId },
      });
      return NextResponse.json({ ...admission, detectedParentId: match.parentId }, { status: 201 });
    }
  } catch (err) {
    console.error(`[admin-admissions POST] sibling-detect failed for admission ${admission.id}:`, err);
  }
  return NextResponse.json(admission, { status: 201 });
}
