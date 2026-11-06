import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { prisma } from "@/lib/db";
import { sentraLabel } from "@/lib/sentra/rotation";
import { legacyCenterFromSlug } from "@/lib/sentra/legacy-slug";
import { CenterSessionClient } from "./client";

export default async function TeacherCenterPage({
  params,
}: {
  params: Promise<{ center: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "TEACHER") redirect("/");
  if (!session.tenantId || !session.employeeId) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Akun belum terhubung dengan staf"
        description="Hubungi admin agar akun Anda dipasangkan dengan data karyawan."
      />
    );
  }

  const { center: segment } = await params;

  // Legacy bookmark (`/center/worship`): hop to the teacher-campus sentra that
  // stands for that old value.
  const legacy = legacyCenterFromSlug(segment);
  if (legacy) {
    const employee = await prisma.employee.findFirst({
      where: { id: session.employeeId, tenantId: session.tenantId },
      select: { campusId: true },
    });
    const match = employee?.campusId
      ? await prisma.sentra.findFirst({
          where: {
            tenantId: session.tenantId,
            campusId: employee.campusId,
            legacyCenter: legacy,
            status: "ACTIVE",
          },
          select: { id: true },
        })
      : null;
    if (!match) notFound();
    redirect(`/teacher/assessments/center/${match.id}`);
  }

  const employee = await prisma.employee.findFirst({
    where: { id: session.employeeId, tenantId: session.tenantId },
    select: { campusId: true },
  });
  const sentra = employee?.campusId
    ? await prisma.sentra.findFirst({
        where: {
          id: segment,
          tenantId: session.tenantId,
          campusId: employee.campusId,
          status: "ACTIVE",
        },
        select: { id: true, name: true },
      })
    : null;
  if (!sentra) notFound();

  return (
    <CenterSessionClient
      sentraId={sentra.id}
      centerLabel={sentraLabel(sentra.name)}
    />
  );
}
