import { formatMonthLabel } from "@/lib/format";
import { defaultDueDateForPeriod, lastDayOfMonth } from "@/lib/finance/period-label";

// Shared default period/due-date/year derivation for the "Buat Tagihan"
// forms (Cycle B1, Task T8). Lives in the wizard directory rather than in
// invoices-client.tsx so both the legacy dialog (invoices-client.tsx) and
// the wizard's step 1 (step-1-scope.tsx) import the SAME function instead
// of one re-deriving the other's logic — and so neither file has to import
// a value back out of invoices-client.tsx, which would create a module
// cycle (invoices-client.tsx already imports the wizard to render it).

export type AcademicYear = { id: string; name: string; status: string };

// Moved to lib/finance so server code can share it; re-exported so every
// existing importer keeps working unchanged.
export { defaultDueDateForPeriod };

export function computeDefaultBillingForm(years: AcademicYear[]) {
  const now = new Date();
  const monthName = formatMonthLabel(now.getFullYear(), now.getMonth() + 1);
  const dueDate = lastDayOfMonth(now.getFullYear(), now.getMonth() + 1);
  const activeYear = years.find((y) => y.status === "ACTIVE");
  return { periodLabel: monthName, dueDate, academicYearId: activeYear?.id ?? "" };
}
