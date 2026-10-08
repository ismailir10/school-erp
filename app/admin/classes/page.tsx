import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { ClassesClient } from "./client";

// Admin Kelas list — the consolidated per-year class management surface that
// replaces the previous /admin/class-tracks UI and the embedded sections
// table on /admin/academic-years. ClassTrack remains in the schema as
// plumbing and is find-or-created on POST.
//
// Cross-checked against .claude/standards/design-system.html §Page header +
// §DataTable + §Dialog (frontend gate).
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ yearId?: string | string[] }>;
}) {
  const session = await assertPermission("academic.view");
  const { yearId } = await searchParams;
  return (
    <ClassesClient
      canWrite={hasPermission(session, "academic.edit")}
      initialYearId={typeof yearId === "string" ? yearId : undefined}
    />
  );
}
