import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export const RAPORT_WRITE_BUDGET = 60;
export const RAPORT_WRITE_WINDOW_MS = 60_000;

export type ResolvedTerm = {
  id: string;
  number: number;
  startDate: Date;
  endDate: Date;
  semester: { number: number; academicYear: { name: string } };
};

/** Fetch a non-deleted Term scoped to the tenant, or null. */
export async function resolveTerm(
  tenantId: string,
  termId: string,
): Promise<ResolvedTerm | null> {
  return prisma.term.findFirst({
    where: { id: termId, tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      semester: { select: { number: true, academicYear: { select: { name: true } } } },
    },
  });
}

/**
 * Shared publish / unpublish handler. Flips `status` + `publishedAt` on an
 * existing entry. The caller route gates `reportCard.publish` and passes the
 * resolved session (kept in the route so the API-auth coverage guard sees the
 * `requirePermission` call per-file). The entry must already be saved
 * (publish has nothing to act on otherwise → 404).
 */
export async function setPublishState(
  req: NextRequest,
  session: { tenantId: string; id: string },
  studentId: string,
  termId: string,
  publish: boolean,
): Promise<Response> {
  const { success } = rateLimit(
    `raport-publish:${getClientIp(req)}`,
    RAPORT_WRITE_BUDGET,
    RAPORT_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const existing = await prisma.reportCardEntry.findFirst({
    where: { tenantId: session.tenantId, studentId, termId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Raport belum dibuat — simpan terlebih dahulu." },
      { status: 404 },
    );
  }

  const updated = await prisma.reportCardEntry.update({
    where: { id: existing.id },
    data: {
      status: publish ? "PUBLISHED" : "DRAFT",
      publishedAt: publish ? new Date() : null,
    },
    select: { id: true, status: true, publishedAt: true, updatedAt: true },
  });
  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "ReportCardEntry",
    entityId: existing.id,
    action: publish ? "publish" : "unpublish",
  });

  // Evict the parent portal's published-raport cache so the new publish state
  // surfaces on /parent/reports without waiting out the 120s TTL. Next.js tags
  // are global (not per-student), so this evicts every student's entry — the
  // known coarse-grain behaviour, acceptable given the short TTL.
  revalidateTag("parent-report-cards", { expire: 0 });

  return NextResponse.json({ data: updated });
}

/** Columns returned for a saved ReportCardEntry. */
export const reportCardEntrySelect = {
  id: true,
  studentId: true,
  termId: true,
  homeroomTeacherId: true,
  sectionLevels: true,
  sectionNarratives: true,
  permittedAbsenceDays: true,
  sickDays: true,
  unexcusedAbsenceDays: true,
  totalSchoolDays: true,
  parentMeetingAttendance: true,
  memorizationNotes: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
} as const;
