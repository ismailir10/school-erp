import { formatMonthLabel } from "@/lib/format";
import { parsePeriodMonth } from "@/lib/finance/period-label";

// Shared default period/due-date/year derivation for the "Buat Tagihan"
// forms (Cycle B1, Task T8). Lives in the wizard directory rather than in
// invoices-client.tsx so both the legacy dialog (invoices-client.tsx) and
// the wizard's step 1 (step-1-scope.tsx) import the SAME function instead
// of one re-deriving the other's logic — and so neither file has to import
// a value back out of invoices-client.tsx, which would create a module
// cycle (invoices-client.tsx already imports the wizard to render it).

export type AcademicYear = { id: string; name: string; status: string };

function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(year, month, 0); // day 0 of the next month = last day of `month` (1-12)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

/**
 * End of the month named by a typed period label ("Oktober 2026", "Okt 2026"),
 * or `null` when the label does not name one month + year (e.g. "Semester 1
 * 2025/2026") — the caller then leaves the due date alone. Same rule as the
 * default for the current month, applied to the PERIOD's month so a run typed
 * for next month is not due before it starts.
 */
export function defaultDueDateForPeriod(periodLabel: string): string | null {
  const parsed = parsePeriodMonth(periodLabel);
  return parsed ? lastDayOfMonth(parsed.year, parsed.month) : null;
}

export function computeDefaultBillingForm(years: AcademicYear[]) {
  const now = new Date();
  const monthName = formatMonthLabel(now.getFullYear(), now.getMonth() + 1);
  const dueDate = lastDayOfMonth(now.getFullYear(), now.getMonth() + 1);
  const activeYear = years.find((y) => y.status === "ACTIVE");
  return { periodLabel: monthName, dueDate, academicYearId: activeYear?.id ?? "" };
}
