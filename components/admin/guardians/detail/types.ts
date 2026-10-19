/**
 * Shape of GET /api/parents/[id] as the wali dossier consumes it. Amounts are
 * JSON numbers (the route converts Decimals before it responds).
 */

import type { DetailInvoice, UnpaidInvoice } from "@/lib/parent/detail-invoices";
import type { StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";

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

// The API's own types (Prisma-free), so the page and the route cannot drift apart.
export type ParentInvoiceRow = DetailInvoice;
export type UnpaidInvoiceRow = UnpaidInvoice;
export type ParentInvoiceSummary = StudentInvoiceSummary;

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
