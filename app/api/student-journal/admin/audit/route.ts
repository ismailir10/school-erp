import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { enrichAuditsWithChangerNames } from "@/lib/student-journal/note-metadata";

/**
 * GET /api/student-journal/admin/audit
 *
 * Returns audit rows for a specific entity or for all entries/notes
 * belonging to a student.
 *
 * Query params (mutually exclusive — entityId takes priority):
 *   ?entityType=ENTRY&entityId=<id>   → filter by both entity fields
 *   ?studentId=<id>                   → collect entry/note IDs for student,
 *                                        then fetch audit rows for that set
 *
 * Always scoped to session.tenantId. Returns at most 100 rows, newest first.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { session } = guard;

  const { searchParams } = req.nextUrl;
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  const studentId = searchParams.get("studentId");

  let auditRows;

  if (entityId && entityType) {
    // Filter by specific entity
    auditRows = await prisma.studentJournalAudit.findMany({
      where: {
        tenantId: session.tenantId,
        entityType,
        entityId,
      },
      orderBy: { changedAt: "desc" },
      take: 100,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        beforeJson: true,
        afterJson: true,
        changedByUserId: true,
        changedAt: true,
      },
    });
  } else if (studentId) {
    // Verify student belongs to tenant
    const student = await prisma.student.findFirst({
      where: { id: studentId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!student) {
      return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
    }

    // Collect entry IDs for this student in the tenant
    const [entries, notes] = await Promise.all([
      prisma.studentJournalEntry.findMany({
        where: { tenantId: session.tenantId, studentId },
        select: { id: true },
      }),
      prisma.studentJournalNote.findMany({
        where: { tenantId: session.tenantId, studentId },
        select: { id: true },
      }),
    ]);

    const entityIds = [
      ...entries.map((e) => e.id),
      ...notes.map((n) => n.id),
    ];

    if (entityIds.length === 0) {
      return NextResponse.json({ data: [] });
    }

    auditRows = await prisma.studentJournalAudit.findMany({
      where: {
        tenantId: session.tenantId,
        entityId: { in: entityIds },
      },
      orderBy: { changedAt: "desc" },
      take: 100,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        beforeJson: true,
        afterJson: true,
        changedByUserId: true,
        changedAt: true,
      },
    });
  } else {
    return NextResponse.json(
      { error: "Berikan entityType+entityId atau studentId" },
      { status: 400 },
    );
  }

  const auditRowsWithChangerNames = await enrichAuditsWithChangerNames(
    session.tenantId,
    auditRows,
  );

  const entryIds = auditRows.filter((row) => row.entityType === "ENTRY").map((row) => row.entityId);
  const contexts = entryIds.length ? await prisma.studentJournalEntry.findMany({
    where: { tenantId: session.tenantId, id: { in: entryIds } },
    select: { id: true, date: true, indicator: { select: { label: true } } },
  }) : [];
  const contextById = new Map(contexts.map((entry) => [entry.id, entry]));
  return NextResponse.json({ data: auditRowsWithChangerNames.map((row) => ({
    ...row,
    entryLabel: contextById.get(row.entityId)?.indicator?.label ?? null,
    entryDate: contextById.get(row.entityId)?.date ?? null,
  })) });
}
