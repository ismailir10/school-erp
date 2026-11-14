import { prisma } from "@/lib/db";
import { formatJakartaYmd } from "@/lib/validations/curriculum";

/** Curriculum weeks are school weeks, fully inside their semester. */
export function schoolWeekError(start: string, end: string, semesterStart?: string, semesterEnd?: string): string | null {
  const monday = new Date(`${start}T00:00:00Z`);
  const friday = new Date(`${end}T00:00:00Z`);
  if (monday.getUTCDay() !== 1 || friday.getUTCDay() !== 5 || friday.getTime() - monday.getTime() !== 4 * 86400000) {
    return "Pekan harus dimulai Senin dan berakhir Jumat pada minggu yang sama.";
  }
  if ((semesterStart && start < semesterStart) || (semesterEnd && end > semesterEnd)) {
    return "Tanggal pekan harus berada dalam rentang semester.";
  }
  return null;
}

export async function validateWeekSemester(subThemeId: string, tenantId: string, start: string, end: string) {
  const parent = await prisma.subTheme.findFirst({
    where: { id: subThemeId, tenantId },
    select: { theme: { select: { semester: { select: { startDate: true, endDate: true } } } } },
  });
  if (!parent) return "Subtema tidak ditemukan.";
  const semester = parent.theme.semester;
  return schoolWeekError(start, end, formatJakartaYmd(semester.startDate), formatJakartaYmd(semester.endDate));
}
