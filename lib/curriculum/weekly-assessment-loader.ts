import { prisma } from "@/lib/db";
import { getHomeroomClassSection } from "@/lib/curriculum/homeroom";
import { getCurrentWeek } from "@/lib/curriculum/week-resolver";
import {
  formatJakartaYmd,
  parseJakartaYmd,
} from "@/lib/validations/curriculum";

export type WeeklyAssessmentPayload =
  | { ok: false; status: 404; reason: "no_active_year"; message: string }
  | {
      ok: false;
      status: 404;
      reason: "not_homeroom";
      message: string;
    }
  | {
      ok: false;
      status: 404;
      reason: "no_active_week";
      message: string;
      classSection: { id: string; name: string; ageGroup: "A" | "B" };
    }
  | {
      ok: true;
      status: 200;
      week: {
        id: string;
        number: number;
        startDate: string;
        endDate: string;
        subTheme: { id: string; name: string };
        theme: { id: string; name: string };
      };
      classSection: { id: string; name: string; ageGroup: "A" | "B" };
      students: Array<{ id: string; name: string; nickname: string | null; status: string }>;
      indicators: Array<{
        id: string;
        content: string;
        order: number;
        objective: { id: string; ageGroup: string; element: string };
      }>;
      entries: Array<{
        id: string;
        studentId: string;
        indicatorId: string;
        date: string;
        level: string;
        note: string | null;
      }>;
    };

/**
 * Single source of truth for the walas weekly assessment screen.
 * Used by both `/teacher/assessments/weekly/page.tsx` (SSR) and
 * `GET /api/teacher/assessment-entries/weekly` (client refetch on tap-write).
 */
export async function loadWeeklyAssessment(
  tenantId: string,
  employeeId: string,
  jakartaYmd: string,
): Promise<WeeklyAssessmentPayload> {
  const activeYear = await prisma.academicYear.findFirst({
    where: { tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!activeYear) {
    return {
      ok: false,
      status: 404,
      reason: "no_active_year",
      message:
        "Tahun ajaran aktif belum diset. Hubungi admin untuk mengaktifkan tahun ajaran.",
    };
  }

  const homeroom = await getHomeroomClassSection(
    tenantId,
    employeeId,
    activeYear.id,
  );
  if (!homeroom) {
    return {
      ok: false,
      status: 404,
      reason: "not_homeroom",
      message:
        "Akun ini bukan walas dari kelas manapun pada tahun ajaran aktif.",
    };
  }

  const ageGroup = homeroom.ageGroup;
  const targetUtcMidnight = parseJakartaYmd(jakartaYmd);
  const week = await getCurrentWeek(tenantId, targetUtcMidnight, ageGroup);
  if (!week) {
    return {
      ok: false,
      status: 404,
      reason: "no_active_week",
      message:
        "Belum ada Pekan aktif untuk tanggal yang dipilih. Pilih tanggal lain atau minta admin menambah pekan.",
      classSection: { id: homeroom.id, name: homeroom.name, ageGroup },
    };
  }

  const enrollments = await prisma.studentEnrollment.findMany({
    where: { classSectionId: homeroom.id, status: "ACTIVE" },
    select: {
      student: {
        select: { id: true, name: true, nickname: true, status: true },
      },
    },
    orderBy: { student: { name: "asc" } },
  });
  const students = enrollments
    .map((e) => e.student)
    .filter((s) => s.status === "ACTIVE");

  const linkedIndicators = await prisma.achievementIndicator.findMany({

    where: {
      tenantId,
      status: "ACTIVE",
      themeLinks: { some: { themeId: week.subTheme.theme.id } },
      objective: { ageGroup },
    },
    select: {
      id: true,
      content: true,
      order: true,
      objective: { select: { id: true, ageGroup: true, element: true } },
    },
    orderBy: [{ objective: { element: "asc" } }, { order: "asc" }],
  });

  const studentIds = students.map((s) => s.id);
  const existingEntries =
    studentIds.length > 0
      ? await prisma.assessmentEntry.findMany({
          where: {
            tenantId,
            weekId: week.id,
            studentId: { in: studentIds },
            source: "HOMEROOM",
          },
          select: {
            id: true,
            studentId: true,
            indicatorId: true,
            date: true,
            level: true,
            note: true,
          },
        })
      : [];

  return {
    ok: true,
    status: 200,
    week: {
      id: week.id,
      number: week.number,
      startDate: formatJakartaYmd(week.startDate),
      endDate: formatJakartaYmd(week.endDate),
      subTheme: { id: week.subTheme.id, name: week.subTheme.name },
      theme: { id: week.subTheme.theme.id, name: week.subTheme.theme.name },
    },
    classSection: { id: homeroom.id, name: homeroom.name, ageGroup },
    students,
    indicators: linkedIndicators,
    entries: existingEntries.map((e) => ({
      ...e,
      date: formatJakartaYmd(e.date),
    })),
  };
}
