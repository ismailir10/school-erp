import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatLearningCenter,
  type LearningCenterKey,
  ALL_LEARNING_CENTERS,
} from "@/lib/format";
import { CenterSessionClient } from "./client";

const VALID_CENTERS = new Set<string>(ALL_LEARNING_CENTERS);

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

  const { center: centerSlug } = await params;
  const centerKey = centerSlug.toUpperCase();
  if (!VALID_CENTERS.has(centerKey)) {
    notFound();
  }
  const center = centerKey as LearningCenterKey;

  return (
    <CenterSessionClient
      center={center}
      centerLabel={formatLearningCenter(center)}
    />
  );
}
