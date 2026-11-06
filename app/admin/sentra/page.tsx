import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { SentraClient } from "./client";

// Admin Sentra — sentra list + putaran list per campus.
// Cross-checked against .claude/standards/design-system.html §Page header +
// §DataTable + §Dialog (frontend gate).
export default async function SentraPage({
  searchParams,
}: {
  searchParams: Promise<{ campusId?: string | string[] }>;
}) {
  const session = await assertPermission("academic.view");
  const { campusId } = await searchParams;
  return (
    <SentraClient
      canWrite={hasPermission(session, "academic.edit")}
      initialCampusId={typeof campusId === "string" ? campusId : undefined}
    />
  );
}
