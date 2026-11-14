import { assertPermission } from "@/lib/auth-guards";
import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Peran & Izin");

export default async function Layout({ children }: { children: React.ReactNode }) {
  await assertPermission("users.view");
  return children;
}
