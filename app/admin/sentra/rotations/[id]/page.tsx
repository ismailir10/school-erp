import type { Metadata } from "next";
import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { RotationDetailClient } from "./client";

export const metadata: Metadata = { title: "Detail Putaran" };

// Admin Sentra — putaran detail with the grid editor.
// Cross-checked against .claude/standards/design-system.html §Page header +
// §Dialog + §Table (frontend gate).
export default async function RotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await assertPermission("academic.view");
  const { id } = await params;
  return <RotationDetailClient rotationId={id} canWrite={hasPermission(session, "academic.edit")} />;
}
