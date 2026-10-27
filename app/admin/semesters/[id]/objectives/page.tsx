import { notFound } from "next/navigation";
import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ObjectivesClient } from "./client";

/**
 * Tujuan Pembelajaran (TP) + Indikator Ketercapaian (IKTP) + theme-link
 * authoring page for a single Semester (C3). Server-side `curriculum.read`
 * gate; `canWrite` follows the `curriculum.write` permission.
 * Cross-checked against `.claude/standards/design-system.html`
 * §Page header + §Accordion + §Dialog + §matrix patterns before edit.
 */
export default async function SemesterObjectivesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await assertPermission("curriculum.read");
  const { id } = await params;

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
    <ObjectivesClient
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
