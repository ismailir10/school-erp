import type { Metadata } from "next";
import { cache } from "react";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { prisma } from "@/lib/db";
import { sentraLabel } from "@/lib/sentra/rotation";
import { legacyCenterFromSlug } from "@/lib/sentra/legacy-slug";
import { CenterSessionClient } from "./client";

type CenterPageProps = { params: Promise<{ center: string }> };

const findTeacherSentra = cache(async (segment: string, tenantId: string, employeeId: string) => {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { campusId: true },
  });
  if (!employee?.campusId) return null;

  const legacy = legacyCenterFromSlug(segment);
  return prisma.sentra.findFirst({
    where: {
      ...(legacy ? { legacyCenter: legacy } : { id: segment }),
      tenantId,
      campusId: employee.campusId,
      status: "ACTIVE",
    },
    select: { id: true, name: true },
  });
});

export async function generateMetadata({ params }: CenterPageProps): Promise<Metadata> {
  const session = await getSession();
  if (session?.role !== "TEACHER" || !session.tenantId || !session.employeeId) {
    return { title: "Sentra Harian" };
  }

  const { center } = await params;
  const sentra = await findTeacherSentra(center, session.tenantId, session.employeeId);
  if (!sentra) notFound();

  return { title: sentraLabel(sentra.name) };
}

export default async function TeacherCenterPage({ params }: CenterPageProps) {
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
  const sentra = await findTeacherSentra(segment, session.tenantId, session.employeeId);
  if (!sentra) notFound();

  // Legacy bookmark (`/center/worship`): hop to the teacher-campus sentra that
  // stands for that old value.
  if (legacyCenterFromSlug(segment)) {
    redirect(`/teacher/assessments/center/${sentra.id}`);
  }

  return (
    <CenterSessionClient
      sentraId={sentra.id}
      centerLabel={sentraLabel(sentra.name)}
    />
  );
}
