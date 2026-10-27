import { notFound } from "next/navigation";
import { assertPermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/db";
import { ImportPromesClient } from "./client";

/**
 * Admin PROMES import surface (C2/T6). Server gate is `curriculum.write`
 * (SUPER_ADMIN and SCHOOL_ADMIN by system-role defaults). The
 * route layer also enforces the gate, so this server-side
 * `assertPermission` is for navigation hygiene (avoid rendering the
 * page chrome to a caller who would 403 the API call).
 *
 * Cross-checked against `.claude/standards/design-system.html` §Card,
 * §Alert, §RadioGroup, §PageHeader before edit.
 */
export default async function PromesImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await assertPermission("curriculum.write");
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
    <ImportPromesClient
      semester={{
        id: semester.id,
        number: semester.number as 1 | 2,
        academicYearName: semester.academicYear.name,
        status: semester.status,
      }}
    />
  );
}
