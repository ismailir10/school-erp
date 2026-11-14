import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import AcademicPage from "./client";

export default async function Page() {
  const session = await assertPermission("academic.view");
  return <AcademicPage canWrite={hasPermission(session, "academic.edit")} />;
}
