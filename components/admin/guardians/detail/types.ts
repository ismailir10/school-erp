/**
 * Shape of GET /api/parents/[id] as the wali dossier consumes it. Amounts are
 * JSON numbers (the route converts Decimals before it responds).
 */

export type GuardianChild = {
  id: string;
  relationship: string;
  isPrimary: boolean;
  status: string;
  /** What this wali still owes for this child (all invoices, server-summed). */
  outstanding: number;
  student: {
    id: string;
    name: string;
    status: string;
    gender: string | null;
    className: string | null;
  };
};

export type ParentInvoiceRow = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  totalDue: number;
  totalPaid: number;
  status: string;
  dueDate: string | null;
  studentId: string;
  studentName: string;
};

export type UnpaidInvoiceRow = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  studentName: string;
  remaining: number;
};

export type ParentInvoiceSummary = {
  invoiceCount: number;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  unpaidCount: number;
  nearestDue: string | null;
  overdueCount: number;
};

export type ParentDetail = {
  canEdit: boolean;
  /** Viewer holds payments.record, so may send and stamp WhatsApp reminders. */
  canRemind: boolean;
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  nik: string | null;
  education: string | null;
  occupation: string | null;
  employer: string | null;
  employerAddress: string | null;
  employerCity: string | null;
  incomeRange: string | null;
  childrenTotal: number | null;
  hasKtp: boolean;
  hasKk: boolean;
  status: string;
  invoiceSummary: ParentInvoiceSummary;
  guardians: GuardianChild[];
  invoices: ParentInvoiceRow[];
  unpaidInvoices: UnpaidInvoiceRow[];
};

export const SECTION_PROFILE = "profile";
export const SECTION_DOCUMENTS = "documents";
export const SECTION_CHILDREN = "children";
export const SECTION_INVOICES = "invoices";
