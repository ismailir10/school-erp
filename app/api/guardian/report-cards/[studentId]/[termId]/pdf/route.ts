import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ReportCardPdf } from "@/lib/pdf/report-card";
import { buildReportCardData, raportFileName } from "@/lib/raport/build";
import { resolveTerm } from "@/app/api/admin/report-cards/_helpers";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";

type Ctx = { params: Promise<{ studentId: string; termId: string }> };

/**
 * GET /api/guardian/report-cards/[studentId]/[termId]/pdf
 *
 * Guardian-facing raport PDF — the parent portal's "Unduh PDF". Mirrors the
 * admin PDF route's render (shared `buildReportCardData` + `ReportCardPdf`) but
 * with guardian security: GUARDIAN role, the student must be linked to the
 * session's parent, and only PUBLISHED entries are served. Any failure returns
 * a flat 404 so a guardian can't probe which students / terms exist.
 *
 * The admin PDF route is gated by `reportCard.read` (a SUPER_ADMIN/SCHOOL_ADMIN
 * permission) and is therefore unreachable by a GUARDIAN — hence this route.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.tenantId || session.role !== "GUARDIAN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { studentId, termId } = await ctx.params;
  const tenantId = session.tenantId;

  // Ownership: the student must be one of this parent's linked children.
  // Contract mirrors lib/parent-helpers.ts `_getParentWithChildren` — require
  // `parentId` OR a non-empty `email` before querying. Without this guard, a
  // GUARDIAN session carrying both null would hit `findFirst({ where: { email:
  // null, tenantId } })`, which Prisma resolves as a tenant-only lookup and
  // returns the FIRST null-email parent (staging has ~200) — a cross-family
  // raport-PDF leak. Flat 404 on the degenerate session, same as a miss.
  const hasEmail = typeof session.email === "string" && session.email.length > 0;
  if (!session.parentId && !hasEmail) {
    return NextResponse.json({ error: "Tidak ditemukan." }, { status: 404 });
  }
  const parent = await prisma.parent.findFirst({
    where: session.parentId
      ? { id: session.parentId, tenantId }
      : { email: session.email as string, tenantId },
    select: { guardians: { select: { studentId: true } } },
  });
  const owns = parent?.guardians.some((g) => g.studentId === studentId) ?? false;
  if (!owns) {
    return NextResponse.json({ error: "Tidak ditemukan." }, { status: 404 });
  }

  const [term, student, entry, measurement, tenant] = await Promise.all([
    resolveTerm(tenantId, termId),
    prisma.student.findFirst({
      where: { id: studentId, tenantId },
      select: {
        name: true,
        enrollments: {
          where: {
            status: "ACTIVE",
            // Exclude ARCHIVED-year rows. Un-closed prior-year ACTIVE
            // enrollments (bulk-import artifact — see T9 regression,
            // docs/cycles/2026-08-21-enrollment-flexibility.md) would
            // otherwise sit in `pickPrimaryEnrollment`'s pool alongside the
            // real current-year row and can win its earliest-enrollDate
            // tiebreak, naming last year's class on the raport.
            classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
          },
          // No `take: 1` — a dual-enrolled student (sekolah + daycare) needs
          // every ACTIVE row so `pickPrimaryEnrollment` below can pick the
          // SEMESTER (sekolah) one. A raport must never name the daycare
          // class.
          select: {
            id: true,
            enrollDate: true,
            classSection: { select: { name: true, program: { select: { type: true } } } },
          },
        },
      },
    }),
    prisma.reportCardEntry.findFirst({
      where: { tenantId, studentId, termId, status: "PUBLISHED", deletedAt: null },
      select: {
        sectionLevels: true,
        sectionNarratives: true,
        sickDays: true,
        permittedAbsenceDays: true,
        unexcusedAbsenceDays: true,
        totalSchoolDays: true,
        memorizationNotes: true,
      },
    }),
    prisma.studentMeasurement.findFirst({
      where: { tenantId, studentId, termId, deletedAt: null },
      select: { heightCm: true, weightKg: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);

  // Flat 404 for any missing piece — never disclose that the term/student
  // exists but the raport is unpublished.
  if (!term || !student || !entry) {
    return NextResponse.json({ error: "Rapor belum tersedia." }, { status: 404 });
  }

  const primaryEnrollment =
    student.enrollments.length <= 1
      ? (student.enrollments[0] ?? null)
      : pickPrimaryEnrollment(student.enrollments);

  const data = buildReportCardData({
    schoolName: tenant?.name ?? "Sekolah",
    studentName: student.name,
    className: primaryEnrollment?.classSection.name ?? null,
    termNumber: term.number,
    semesterNumber: term.semester.number,
    academicYear: term.semester.academicYear.name,
    entry,
    measurement,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(ReportCardPdf, { data }) as any);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${raportFileName(student.name, term.number)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
