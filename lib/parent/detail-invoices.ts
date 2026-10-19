import {
  summarizeStudentInvoices,
  UNPAID_INVOICE_STATUSES,
  type StudentInvoiceSummary,
} from "@/lib/finance/student-invoice-summary";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";

/**
 * Pure computation behind `GET /api/parents/[id]` (admin Wali dossier).
 *
 * The route used to read only the latest 20 invoices and the page derived
 * "Piutang" from them, so a family with more invoices saw a smaller debt than
 * it owed. The route now hands the page the roll-up over EVERY invoice of the
 * wali plus a short, unpaid-first list; everything here is Prisma-free so the
 * ordering, caps and per-child sums are unit-testable.
 */

/** Rows shown in the page's invoice section. */
export const DETAIL_INVOICE_LIMIT = 10;
/** Unpaid invoices offered to "Ingatkan via WhatsApp". */
export const UNPAID_INVOICE_LIMIT = 25;

const UNPAID_SET: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

/** One invoice as the route selects it (amounts may be Decimal/string/number). */
export interface ParentInvoiceRow {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  /** YYYY-MM-DD */
  dueDate: string;
  totalDue: number | string | { toString(): string };
  totalPaid: number | string | { toString(): string };
  status: string;
  studentId: string;
  createdAt: Date | string;
  student: { name: string };
}

export interface DetailInvoice {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  totalDue: number;
  totalPaid: number;
  status: string;
  dueDate: string;
  studentId: string;
  studentName: string;
}

export interface UnpaidInvoice {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  studentName: string;
  remaining: number;
}

export interface ParentInvoiceView {
  invoiceSummary: StudentInvoiceSummary;
  invoices: DetailInvoice[];
  unpaidInvoices: UnpaidInvoice[];
  /** studentId → sum of `remaining` over this wali's unpaid invoices. */
  owedByStudent: Record<string, number>;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function time(value: Date | string): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Money still owed on this row, 0 when it is not an unpaid status. */
function remainingOf(inv: Pick<ParentInvoiceRow, "status" | "totalDue" | "totalPaid">): number {
  if (!UNPAID_SET.has(inv.status)) return 0;
  return Math.max(0, num(inv.totalDue) - num(inv.totalPaid));
}

export function buildParentInvoiceView(rows: readonly ParentInvoiceRow[]): ParentInvoiceView {
  const invoiceSummary = summarizeStudentInvoices(
    rows.map((r) => ({
      status: r.status,
      dueDate: r.dueDate,
      totalDue: num(r.totalDue),
      totalPaid: num(r.totalPaid),
    })),
  );

  const owedByStudent: Record<string, number> = {};
  const unpaid: Array<{ row: ParentInvoiceRow; remaining: number }> = [];
  for (const row of rows) {
    const remaining = remainingOf(row);
    if (remaining <= 0) continue;
    unpaid.push({ row, remaining });
    owedByStudent[row.studentId] = (owedByStudent[row.studentId] ?? 0) + remaining;
  }

  // Unpaid-with-remaining first, then everything else; newest first inside
  // each group. Array.prototype.sort is stable, so equal timestamps keep the
  // order the query returned.
  const unpaidIds = new Set(unpaid.map((u) => u.row.id));
  const ordered = [...rows].sort((a, b) => {
    const au = unpaidIds.has(a.id) ? 0 : 1;
    const bu = unpaidIds.has(b.id) ? 0 : 1;
    if (au !== bu) return au - bu;
    return time(b.createdAt) - time(a.createdAt);
  });

  const invoices: DetailInvoice[] = ordered.slice(0, DETAIL_INVOICE_LIMIT).map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    periodLabel: r.periodLabel,
    totalDue: num(r.totalDue),
    totalPaid: num(r.totalPaid),
    status: r.status,
    dueDate: r.dueDate,
    studentId: r.studentId,
    studentName: r.student.name,
  }));

  // Oldest due date first (chase the oldest debt); invoice number breaks ties.
  const unpaidInvoices: UnpaidInvoice[] = [...unpaid]
    .sort((a, b) =>
      a.row.dueDate === b.row.dueDate
        ? a.row.invoiceNumber.localeCompare(b.row.invoiceNumber)
        : a.row.dueDate < b.row.dueDate
          ? -1
          : 1,
    )
    .slice(0, UNPAID_INVOICE_LIMIT)
    .map(({ row, remaining }) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      periodLabel: row.periodLabel,
      studentName: row.student.name,
      remaining,
    }));

  return { invoiceSummary, invoices, unpaidInvoices, owedByStudent };
}

/** The enrollment fields the route selects to name a child's class. */
export interface ClassNameEnrollment {
  id: string;
  enrollDate: string;
  status?: string;
  classSection: {
    name: string;
    program: { type: string };
    academicYear?: { status: string } | null;
  };
}

/**
 * Class name of the student's primary current enrollment: ACTIVE, in a
 * non-ARCHIVED academic year, preferring the SEMESTER (sekolah) row.
 */
export function primaryClassName(enrollments: readonly ClassNameEnrollment[]): string | null {
  const current = enrollments.filter(
    (e) =>
      (e.status === undefined || e.status === "ACTIVE") &&
      e.classSection.academicYear?.status !== "ARCHIVED",
  );
  return pickPrimaryEnrollment(current)?.classSection.name ?? null;
}
