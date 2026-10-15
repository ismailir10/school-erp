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
import { deriveStage, isStage, stageWhere, UNPAID_WHERE } from "@/lib/admission/stage";
import { canRemind } from "@/lib/enrollment/follow-up";
import { isFeeClosed } from "@/lib/enrollment/fee-closed";
import type { Prisma } from "@/lib/generated/prisma/client";

const EMPTY_STATS = { total: 0, baru: 0, formulirDikirim: 0, belumBayar: 0, formulirMasuk: 0, diterima: 0, siswa: 0 };

/**
 * GET /api/admissions — the unified Pendaftaran list (cycle 2026-10-11-pendaftaran-simplify).
 *
 * One row per lead. Each carries its derived `stage` (lib/admission/stage), the formulir
 * fee's `payment` (UNPAID | PAID | WAIVED | NONE) and a lean `application` (no token, no
 * payment URL, no form blocks). `?tahap=<STAGE>` and `?payment=unpaid` filter in the
 * database so pagination stays right. `stats` counts the caller's whole tenant (search and
 * filters do not touch it) so the page needs no extra requests. The retired `?status=`
 * param is ignored.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  // HR-16: anonymous callers get a real 401, not an empty 200.
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      stats: EMPTY_STATS,
    });
  }
  const tenantId = session.tenantId;
  const canEdit = hasPermission(session, "admissions.edit");

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["createdAt", "childName", "parentName", "status", "followUpDate"],
    default: "createdAt",
    defaultOrder: "desc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;
  const tahapParam = searchParams.get("tahap");
  const tahap = isStage(tahapParam) ? tahapParam : null;
  const unpaidOnly = searchParams.get("payment") === "unpaid";
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  const and: Prisma.AdmissionWhereInput[] = [];
  if (tahap) and.push(stageWhere(tahap));
  if (unpaidOnly) and.push(UNPAID_WHERE);
  if (search) {
    and.push({
      OR: [
        { childName: { contains: search, mode: "insensitive" } },
        { parentName: { contains: search, mode: "insensitive" } },
        { parentPhone: { contains: search, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.AdmissionWhereInput = { tenantId, ...(and.length ? { AND: and } : {}) };
  const scoped = (w: Prisma.AdmissionWhereInput): Prisma.AdmissionWhereInput => ({ tenantId, AND: [w] });

  // The stats total is the whole tenant; with no filter that is exactly `total`, so it is not counted twice.
  const filtered = and.length > 0;

  const [admissions, total, tenantTotal, baru, formulirDikirim, belumBayar, formulirMasuk, diterima, siswa] =
    await Promise.all([
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
          enrollmentApplication: {
            select: {
              id: true,
              status: true,
              program: { select: { name: true } },
              studentId: true,
              submittedAt: true,
              fee: { select: { status: true, amount: true } },
            },
          },
        },
        // `id` breaks ties so a page boundary can never repeat or skip a row that shares the sort value.
        orderBy: [orderBy, { id: "asc" }],
      }),
      prisma.admission.count({ where }),
      filtered ? prisma.admission.count({ where: { tenantId } }) : Promise.resolve(null),
      prisma.admission.count({ where: scoped(stageWhere("BARU")) }),
      prisma.admission.count({ where: scoped(stageWhere("FORMULIR_DIKIRIM")) }),
      // The same predicate as the ?payment=unpaid filter, so the "Belum bayar" card and its filter agree.
      prisma.admission.count({ where: scoped(UNPAID_WHERE) }),
      prisma.admission.count({ where: scoped(stageWhere("FORMULIR_MASUK")) }),
      prisma.admission.count({ where: scoped(stageWhere("DITERIMA")) }),
      prisma.admission.count({ where: scoped(stageWhere("SISWA")) }),
    ]);

  // Whether a WhatsApp reminder CAN be sent matters only for an open, unpaid fee and only to staff
  // who can send one. The lead's own numbers answer it for nearly every row; the parents' form
  // blocks (a phone written there is the fallback) are read ONLY for the few rows with no usable
  // lead number, in one query, and never returned.
  const needsFormPhone: string[] = [];
  const remindable = (lead: (typeof admissions)[number], app: NonNullable<(typeof admissions)[number]["enrollmentApplication"]>) =>
    canEdit && app.fee?.status === "UNPAID" && !isFeeClosed({ status: app.status, admission: lead });
  for (const row of admissions) {
    const app = row.enrollmentApplication;
    if (app && remindable(row, app) && !canRemind({ admission: row })) needsFormPhone.push(app.id);
  }
  const formPhoneIds = new Set<string>();
  if (needsFormPhone.length > 0) {
    const blocks = await prisma.enrollmentApplication.findMany({
      where: { id: { in: needsFormPhone }, tenantId },
      select: { id: true, ayahData: true, ibuData: true },
    });
    for (const b of blocks) if (canRemind({ ayahData: b.ayahData, ibuData: b.ibuData })) formPhoneIds.add(b.id);
  }

  const data = admissions.map((row) => {
    const { enrollmentApplication: app, ...lead } = row;
    const fee = app?.fee ?? null;
    // A dead row (rejected formulir, cancelled lead) has no open payment link: nothing to chase, so it
    // never reads "Belum bayar". `application.fee.status` stays the raw value.
    const closed = app ? isFeeClosed({ status: app.status, admission: lead }) : false;
    const payment = fee && !(fee.status === "UNPAID" && closed) ? fee.status : "NONE";
    // The application is picked field by field so nothing the query selects can leak through a spread.
    const application = app
      ? {
          id: app.id,
          status: app.status,
          // The formulir's program is the one that counts once a formulir exists (the lead's own may be unset).
          programName: app.program?.name ?? null,
          studentId: app.studentId,
          submittedAt: app.submittedAt,
          fee: fee
            ? {
                status: fee.status,
                amount: Math.round(Number(fee.amount)),
                // Same rule as /api/enrollments: any unpaid fee whose link is still open (a formulir
                // sent under the old pay-first order can still hold one before it is submitted).
                canRemind: remindable(row, app) && (canRemind({ admission: lead }) || formPhoneIds.has(app.id)),
              }
            : null,
        }
      : null;
    return { ...lead, stage: deriveStage(lead, app), payment, application };
  });

  return NextResponse.json({
    ...paginatedResponse(data, total, page, pageSize),
    stats: { total: tenantTotal ?? total, baru, formulirDikirim, belumBayar, formulirMasuk, diterima, siswa },
    canEdit,
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
