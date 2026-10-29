/**
 * Wire shapes of the Cuti (student leave) API, see
 * `docs/cycles/2026-10-29-student-enrollment-leave.md`. Kept apart from the
 * route files because those import Prisma and this is client code.
 */

export type LeaveEnrollmentSummary = {
  id: string;
  status: string;
  className: string;
  programName: string;
  academicYearName: string;
};

export type StudentLeave = {
  id: string;
  enrollmentId: string;
  /** `YYYY-MM` */
  startMonth: string;
  /** `YYYY-MM`, inclusive */
  endMonth: string;
  reason: string;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  cancelledAt: string | null;
  enrollment: LeaveEnrollmentSummary;
};

/** One of the student's enrollments, with whether a new leave may be recorded on it. */
export type LeaveEnrollmentOption = LeaveEnrollmentSummary & {
  eligible: boolean;
  ineligibleReason: string | null;
  /** The months a leave may cover, `YYYY-MM`; null when the year has no usable dates. */
  window: { from: string; to: string } | null;
};

export type AffectedRun = { id: string; periodLabel: string; status: string };

export type OpenInvoiceLine = { label: string; finalAmount: number; isRecurring: boolean };

export type OpenInvoice = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string;
  totalDue: number;
  dueDate: string;
  lines: OpenInvoiceLine[];
  hasOneOffLines: boolean;
};

export type CreateLeaveResponse = {
  leave: { id: string };
  affectedRuns: AffectedRun[];
  /** Null when the caller may not view invoices. */
  openInvoices: OpenInvoice[] | null;
  canVoid: boolean;
  otherActiveEnrollments: boolean;
};

/** What the "Tagihan yang masih terbuka" dialog shows. */
export type OpenInvoicesFollowUp = {
  invoices: OpenInvoice[];
  canVoid: boolean;
  otherActiveEnrollments: boolean;
};
