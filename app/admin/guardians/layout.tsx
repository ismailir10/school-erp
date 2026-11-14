import { assertPermission } from "@/lib/auth-guards";
import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Wali Murid");

export default async function Layout({ children }: { children: React.ReactNode }) {
  await assertPermission("students.view");
  return children;
}
