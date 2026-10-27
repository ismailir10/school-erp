import { notFound } from "next/navigation";
import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ThemesClient } from "./client";

/**
 * Theme / SubTheme / Week authoring page for a single Semester.
 * Server-side `curriculum.read` gate; `canWrite` follows the
 * `curriculum.write` permission. Cross-checked against
 * `.claude/standards/design-system.html` §Page header + §Dialog +
 * §ConfirmDialog before edit.
 */
export default async function SemesterThemesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await assertPermission("curriculum.read");
  const { id } = await params;

  // assertPermission redirects when tenantId is missing, so the cast is
  // safe here — TS can't see the redirect path.
  const tenantId = session.tenantId as string;
  const semester = await prisma.semester.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      status: true,
      academicYear: { select: { name: true } },
    },
  });
  if (!semester) notFound();

  return (
    <ThemesClient
      canWrite={hasPermission(session, "curriculum.write")}
      semester={{
        id: semester.id,
        number: semester.number as 1 | 2,
        academicYearName: semester.academicYear.name,
        startDate: semester.startDate.toISOString(),
        endDate: semester.endDate.toISOString(),
        status: semester.status,
      }}
    />
  );
}
