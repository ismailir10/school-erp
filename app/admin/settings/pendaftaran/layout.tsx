import { assertPermission } from "@/lib/auth-guards";
import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Pengaturan Pendaftaran");

export default async function Layout({ children }: { children: React.ReactNode }) {
  await assertPermission("admissions.view");
  return children;
}
