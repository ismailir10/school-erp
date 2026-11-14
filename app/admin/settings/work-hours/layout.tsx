import { assertPermission } from "@/lib/auth-guards";
import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Jam Kerja");

export default async function Layout({ children }: { children: React.ReactNode }) {
  await assertPermission("settings.view");
  return children;
}
