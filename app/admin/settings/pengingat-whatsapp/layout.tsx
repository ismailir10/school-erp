import { assertPermission } from "@/lib/auth-guards";
import { pageTitle } from "@/lib/page-title";

export const metadata = pageTitle("Templat Pengingat WhatsApp");

export default async function Layout({ children }: { children: React.ReactNode }) {
  await assertPermission("payments.record");
  return children;
}
