import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { entryBatchSchema } from "@/lib/validations/student-journal";
import { requireTeacherForClass } from "@/lib/student-journal/guards";
import { upsertJournalEntriesWithAudit } from "@/lib/student-journal/entry-writes";

/**
 * POST /api/student-journal/entries/batch
 *
 * Upserts an array of teacher entries for one class-day.
 * scope is always SCHOOL on this endpoint — not accepted from the client.
 *
 * Body: { classSectionId, date, entries: [{ studentId, indicatorId, checked }] }
 */
export async function POST(req: NextRequest) {
  // Parse body first so we can use classSectionId for both rate limit key and auth
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak valid" }, { status: 400 });
  }

  const parsed = entryBatchSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { error: firstIssue?.message ?? "Body permintaan tidak valid" },
      { status: 400 }
    );
  }

  const { classSectionId, date, entries } = parsed.data;

  const guard = await requireTeacherForClass(classSectionId, { viaSentra: true });
  if (guard.error) return guard.error;
  const { session } = guard;

  // Rate limit after auth (keyed per user)
  const rl = rateLimit(`sj-teacher-${session.id}`, 300, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  if (entries.length === 0) {
    return NextResponse.json({ data: { saved: 0 } });
  }

  // Verify all distinct indicatorIds belong to SCHOOL-scope active indicators
  // in this tenant's template. Tenant scoping is enforced both via the template
  // lookup AND defensively on the nested relation chain (template.tenantId).
  const distinctIndicatorIds = [...new Set(entries.map((e) => e.indicatorId))];

  const template = await prisma.studentJournalTemplate.findUnique({
    where: { tenantId: session.tenantId },
  });

  if (!template) {
    return NextResponse.json({ error: "Indikator tidak valid" }, { status: 400 });
  }

  const validIndicators = await prisma.studentJournalIndicator.findMany({
    where: {
      id: { in: distinctIndicatorIds },
      status: JournalStatus.ACTIVE,
      category: {
        scope: "SCHOOL",
        status: JournalStatus.ACTIVE,
        templateId: template.id,
        template: { tenantId: session.tenantId },
      },
    },
    select: { id: true },
  });

  if (validIndicators.length !== distinctIndicatorIds.length) {
    return NextResponse.json({ error: "Indikator tidak valid" }, { status: 400 });
  }

  // Verify all distinct studentIds are actively enrolled in this class. Enrollment
  // has no tenantId column — defensive tenant scope via student.tenantId.
  const distinctStudentIds = [...new Set(entries.map((e) => e.studentId))];

  const validEnrollments = await prisma.studentEnrollment.findMany({
    where: {
      studentId: { in: distinctStudentIds },
      classSectionId,
      status: "ACTIVE",
      student: { tenantId: session.tenantId },
    },
    select: { studentId: true },
  });

  if (validEnrollments.length !== distinctStudentIds.length) {
    return NextResponse.json(
      { error: "Beberapa siswa tidak terdaftar di kelas ini" },
      { status: 400 }
    );
  }

  // Upsert + audit in one transaction (see lib/student-journal/entry-writes).
  const saved = await upsertJournalEntriesWithAudit({
    tenantId: session.tenantId,
    actorUserId: session.id,
    date,
    scope: "SCHOOL",
    classSectionId,
    entries,
  });

  return NextResponse.json({ data: { saved } });
}
