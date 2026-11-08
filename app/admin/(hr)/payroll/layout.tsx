import { pageTitle } from "@/lib/page-title";
import { assertPermission } from "@/lib/auth-guards";

export const metadata = pageTitle("Penggajian");

/**
 * Payroll subtree gate — narrower than the parent (hr) layout.
 *
 * Parent `(hr)/layout.tsx` already enforces `hr.view`. This layer adds
 * `payroll.view` on top so a custom role could be granted `hr.view` without
 * seeing salary figures (e.g. an HR assistant who manages leave but not
 * payroll). SUPER_ADMIN passes both via short-circuit.
 */
export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await assertPermission("payroll.view");
  return <>{children}</>;
}
