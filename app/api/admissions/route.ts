import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { createAdmissionSchema } from "@/lib/validations/admission";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { hasPermission } from "@/lib/permissions";

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

  const parsed = createAdmissionSchema.safeParse(await req.json());
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

  const admission = await prisma.admission.create({
    data: {
      tenantId: session.tenantId,
      childName: body.childName.trim(),
      // childAge is auto-derived at display time from dateOfBirth — never written.
      childGender: body.childGender || null,
      dateOfBirth: body.dateOfBirth || null,
      parentName: body.parentName.trim(),
      parentPhone: body.parentPhone?.trim() || null,
      parentEmail: body.parentEmail?.trim() || null,
      parentWhatsapp: body.parentWhatsapp?.trim() || null,
      parentEducation: body.parentEducation || null,
      parentOccupation: body.parentOccupation || null,
      parentIncome: body.parentIncome || null,
      parentRelationship: body.parentRelationship || null,
      programId: body.programId || null,
      campusPreference: body.campusPreference || null,
      source: body.source ?? "WALK_IN",
      notes: body.notes?.trim() || null,
      followUpDate: body.followUpDate || null,
    },
  });
  return NextResponse.json(admission, { status: 201 });
}
