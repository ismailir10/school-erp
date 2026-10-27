import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { SemestersClient } from "./client";

/**
 * Admin Semester list — entry for the curriculum authoring flow.
 * Server-side `curriculum.read` gate; UI is fully client-side so toolbar
 * filters and create dialog don't round-trip on every interaction.
 *
 * Visual cross-checked against .claude/standards/design-system.html §Page
 * header + §DataTable + §Dialog before edit (frontend gate).
 */
export default async function SemestersPage() {
  const session = await assertPermission("curriculum.read");
  return <SemestersClient canWrite={hasPermission(session, "curriculum.write")} />;
}
