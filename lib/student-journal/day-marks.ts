import { prisma } from "@/lib/db";

/**
 * "Hari tanpa buku penghubung" — a class-day the guru marks as not using the
 * book on purpose (swimming, an outing), with a short keterangan the wali reads
 * in that day's column. Entries already written for the day are never touched:
 * the mark only adds the reason and finishes the day for the guru, so unmarking
 * brings the normal grid straight back.
 */

export type DayMark = { classSectionId: string; date: string; reason: string };

type WriteArgs = {
  tenantId: string;
  actorUserId: string;
  classSectionId: string;
  date: string;
};

/**
 * Create or edit the mark for one class-day, with its audit row, in one
 * transaction. A re-save with the same reason writes no audit row — it should
 * not pad the trail. Callers MUST have run `requireDayMarkWriter` and
 * `isMarkableDate`; this does no authorisation.
 */
export async function saveDayMark({ tenantId, actorUserId, classSectionId, date, reason }: WriteArgs & { reason: string }): Promise<DayMark> {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.studentJournalDayMark.findFirst({
      where: { tenantId, classSectionId, date },
      select: { id: true, reason: true },
    });
    const row = await tx.studentJournalDayMark.upsert({
      where: { classSectionId_date: { classSectionId, date } },
      update: { reason, markedByUserId: actorUserId },
      create: { tenantId, classSectionId, date, reason, markedByUserId: actorUserId },
      select: { id: true },
    });
    if (!prior || prior.reason !== reason) {
      await tx.studentJournalAudit.create({
        data: {
          tenantId,
          entityType: "DAY_MARK",
          entityId: row.id,
          action: prior ? "UPDATE" : "CREATE",
          ...(prior ? { beforeJson: { reason: prior.reason } } : {}),
          afterJson: { reason, classSectionId, date },
          changedByUserId: actorUserId,
        },
      });
    }
    return { classSectionId, date, reason };
  });
}

/** Remove the mark (and audit it). Returns false when there was nothing to remove. */
export async function removeDayMark({ tenantId, actorUserId, classSectionId, date }: WriteArgs): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.studentJournalDayMark.findFirst({
      where: { tenantId, classSectionId, date },
      select: { id: true, reason: true },
    });
    if (!prior) return false;
    // deleteMany, not delete: of two concurrent removals the loser finds count 0
    // and answers "nothing to remove" instead of throwing P2025 into a 500.
    const { count } = await tx.studentJournalDayMark.deleteMany({ where: { id: prior.id, tenantId } });
    if (count === 0) return false;
    await tx.studentJournalAudit.create({
      data: {
        tenantId,
        entityType: "DAY_MARK",
        entityId: prior.id,
        action: "DELETE",
        beforeJson: { reason: prior.reason, classSectionId, date },
        changedByUserId: actorUserId,
      },
    });
    return true;
  });
}

/** The mark for one class-day, or null. */
export async function getDayMark(tenantId: string, classSectionId: string, date: string): Promise<{ reason: string } | null> {
  return prisma.studentJournalDayMark.findFirst({
    where: { tenantId, classSectionId, date },
    select: { reason: true },
  });
}

/**
 * Marks that apply to one student across a week: `date → keterangan`. A student
 * can sit in several ACTIVE classes (day-care + school); when more than one
 * marks the same date the distinct reasons are joined, so the wali is told the
 * whole truth rather than whichever class sorted first.
 */
export async function getDayMarksForStudentWeek(
  tenantId: string,
  studentId: string,
  dates: readonly string[],
): Promise<Record<string, string>> {
  if (dates.length === 0) return {};
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, status: "ACTIVE", classSection: { tenantId } },
    select: { classSectionId: true },
  });
  if (enrollments.length === 0) return {};
  const marks = await prisma.studentJournalDayMark.findMany({
    where: {
      tenantId,
      classSectionId: { in: enrollments.map((e) => e.classSectionId) },
      date: { in: [...dates] },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { date: true, reason: true },
  });
  const byDate: Record<string, string[]> = {};
  for (const m of marks) {
    const reasons = (byDate[m.date] ??= []);
    if (!reasons.includes(m.reason)) reasons.push(m.reason);
  }
  return Object.fromEntries(Object.entries(byDate).map(([d, reasons]) => [d, reasons.join(" · ")]));
}
