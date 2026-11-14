import type { Metadata } from "next";
import { getSession, isAdminRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarX } from "lucide-react";
import { SessionRosterClient } from "./client";

export const metadata: Metadata = { title: "Sesi Kelas" };

// Design-system cross-check: §16 Attendance Flows + §14 Portal Shell. Roster
// uses the Daily Data Entry recipe from .claude/standards/portal.md — Card
// list (<10 typical), StatusBadge-driven status control, EmptyState contract,
// formatTime/formatDate from @/lib/format, Indonesian copy per voice.md.

/**
 * Teacher session roster page (academic-hierarchy-refactor Task 7).
 *
 * Server component: TEACHER-only (redirect otherwise). Loads the ClassSession
 * tenant-scoped and confirms the caller is its effective teacher OR an admin.
 * The roster = ACTIVE-enrolled students left-joined with their
 * StudentAttendance row for this sessionId.
 */
export default async function TeacherSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (
    !session ||
    (session.role !== "TEACHER" && !isAdminRole(session.role))
  ) {
    redirect("/");
  }
  const { id } = await params;

  const classSession = session.tenantId
    ? await prisma.classSession.findFirst({
        where: { id, classSection: { tenantId: session.tenantId } },
        select: {
          id: true,
          date: true,
          slot: true,
          teacherId: true,
          classSectionId: true,
          classSection: { select: { id: true, name: true } },
        },
      })
    : null;

  // Not found / cross-tenant, or the caller is neither the session's effective
  // teacher nor an admin → friendly not-authorized state (no redirect loop).
  const isAdmin = isAdminRole(session.role);
  if (
    !classSession ||
    (!isAdmin && classSession.teacherId !== session.employeeId)
  ) {
    return (
      <div data-empty-state="session-not-authorized">
        <EmptyState
          icon={CalendarX}
          title="Sesi tidak ditemukan"
          description="Sesi kelas ini tidak tersedia atau bukan jadwal mengajar Anda."
        />
      </div>
    );
  }

  const enrollments = await prisma.studentEnrollment.findMany({
    where: { classSectionId: classSession.classSectionId, status: "ACTIVE" },
    select: {
      student: { select: { id: true, name: true, nickname: true } },
    },
    orderBy: { student: { name: "asc" } },
  });

  const attendance = await prisma.studentAttendance.findMany({
    where: { sessionId: classSession.id, isVoided: false },
    select: {
      studentId: true,
      status: true,
      checkInTime: true,
      checkOutTime: true,
      pickedUpByRelation: true,
      pickedUpByName: true,
    },
  });
  const byStudent = new Map(attendance.map((a) => [a.studentId, a]));

  const roster = enrollments.map((e) => {
    const a = byStudent.get(e.student.id);
    return {
      studentId: e.student.id,
      name: e.student.name,
      nickname: e.student.nickname,
      status: a?.status ?? "UNKNOWN",
      checkInTime: a?.checkInTime?.toISOString() ?? null,
      checkOutTime: a?.checkOutTime?.toISOString() ?? null,
      pickedUpByRelation: a?.pickedUpByRelation ?? null,
      pickedUpByName: a?.pickedUpByName ?? null,
    };
  });

  return (
    <SessionRosterClient
      sessionId={classSession.id}
      className={classSession.classSection.name}
      date={classSession.date}
      slot={classSession.slot}
      roster={roster}
    />
  );
}
