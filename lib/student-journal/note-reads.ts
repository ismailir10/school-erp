import type { Prisma } from "@/lib/generated/prisma/client";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";

/** Notes per page in the thread. Small enough that a first paint is one screen. */
export const DEFAULT_NOTE_PAGE_SIZE = 20;
/** Hard ceiling on `?limit=` so a caller cannot ask for the whole history at once. */
export const MAX_NOTE_PAGE_SIZE = 50;

/**
 * Unread notes for one reader on one student.
 *
 * "Unread" is every ACTIVE note **somebody else** wrote after the reader's
 * watermark (`StudentJournalNoteRead.lastReadAt`). Two deliberate rules:
 *
 * - **Own notes never count.** A guru who writes three catatan should not come
 *   back to a badge of three.
 * - **A missing watermark means "never opened", so every note from the other
 *   party is unread.** The row is only created the first time the reader opens
 *   the thread. The earlier rule (missing = zero, to spare wali a rollout badge
 *   for history — `docs/cycles/2026-08-26-journal-notes-cycle-b.md`) meant the
 *   *first* note in a thread could never raise a badge: a parent's first
 *   message to the teacher was invisible until the teacher happened to open the
 *   thread once (X-3, `docs/uat/reports/2026-09-29-full-e2e.md`).
 */
export async function countUnreadNotes({
  tenantId,
  studentId,
  readerUserId,
}: {
  tenantId: string;
  studentId: string;
  readerUserId: string;
}): Promise<number> {
  const watermark = await prisma.studentJournalNoteRead.findUnique({
    where: { userId_studentId: { userId: readerUserId, studentId } },
    select: { lastReadAt: true },
  });

  return prisma.studentJournalNote.count({
    where: {
      tenantId,
      studentId,
      status: JournalStatus.ACTIVE,
      authorUserId: { not: readerUserId },
      // No watermark row = never opened = every note from the other party.
      ...(watermark ? { createdAt: { gt: watermark.lastReadAt } } : {}),
    },
  });
}

/**
 * Unread counts for many students at once — the class-day grid needs one badge
 * per row and must not fan out into N+1 queries across a roster.
 *
 * Same rules as {@link countUnreadNotes}: a student with no watermark row has
 * never been opened by this reader, so all of the other party's notes count.
 * Students with nothing unread are absent from the returned map (read as zero).
 */
export async function countUnreadNotesByStudent({
  tenantId,
  studentIds,
  readerUserId,
  authorRole,
}: {
  tenantId: string;
  studentIds: string[];
  readerUserId: string;
  authorRole?: string;
}): Promise<Record<string, number>> {
  if (studentIds.length === 0) return {};

  const watermarks = await prisma.studentJournalNoteRead.findMany({
    where: { userId: readerUserId, studentId: { in: studentIds } },
    select: { studentId: true, lastReadAt: true },
  });
  const readAtByStudent = new Map(watermarks.map((w) => [w.studentId, w.lastReadAt]));
  const neverOpened = studentIds.filter((id) => !readAtByStudent.has(id));

  // Apply each student's exact watermark in SQL, then return one count row
  // per student. A never-opened thread has no timestamp restriction; an old
  // watermark must not pull other students' already-read histories into memory.
  const scopes: Prisma.StudentJournalNoteWhereInput[] = [];
  if (neverOpened.length > 0) scopes.push({ studentId: { in: neverOpened } });
  for (const watermark of watermarks) {
    scopes.push({
      studentId: watermark.studentId,
      createdAt: { gt: watermark.lastReadAt },
    });
  }

  const groups = await prisma.studentJournalNote.groupBy({
    by: ["studentId"],
    where: {
      tenantId,
      status: JournalStatus.ACTIVE,
      authorUserId: { not: readerUserId },
      ...(authorRole ? { authorRole } : {}),
      OR: scopes,
    },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.studentId] = group._count._all;
  }
  return counts;
}

/**
 * Move a reader's watermark to now. Idempotent per (reader, student) — the
 * unique index is what makes repeat opens a single row rather than a log.
 */
export async function markNotesRead({
  tenantId,
  studentId,
  readerUserId,
  now,
}: {
  tenantId: string;
  studentId: string;
  readerUserId: string;
  now: Date;
}): Promise<Date> {
  const row = await prisma.studentJournalNoteRead.upsert({
    where: { userId_studentId: { userId: readerUserId, studentId } },
    create: { tenantId, userId: readerUserId, studentId, lastReadAt: now },
    update: { lastReadAt: now },
    select: { lastReadAt: true },
  });
  return row.lastReadAt;
}
