import { hasPermission } from "@/lib/permissions";
import { formatDateShort } from "@/lib/format";
import { admissionChildLabel } from "@/lib/admission/child-label";

export type AdminWorkKind = "inquiry" | "enrollment" | "leave" | "invoice" | "payroll";

export type AdminWorkItem = {
  id: string;
  kind: AdminWorkKind;
  title: string;
  description: string;
  href: string;
  state: string;
  recordId: string;
  actionLabel: string;
  timeLabel?: string;
  dueDate?: string;
  /** ISO date used to rank urgency (invoice dueDate, leave startDate, payroll periodStart, enrollment updatedAt, inquiry createdAt). */
  sortDate?: string;
};

export type AdminQueueSection<T> =
  | { status: "hidden" }
  | { status: "unavailable" }
  | { status: "ready"; records: T[]; count: number };

/** A public/walk-in admission inquiry nobody has followed up yet (X-6). */
type InquiryRow = { id: string; childName: string; parentName: string; createdAt: string };
type EnrollmentRow = { id: string; childName: string; status: string; updatedAt: string };
type LeaveRow = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  employee: { nama: string };
};
type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string;
  dueDate?: string;
  student: { name: string };
};
type PayrollRow = { id: string; periodStart: string; periodEnd: string; status: string };

export type AdminQueueSources = {
  inquiries: AdminQueueSection<InquiryRow>;
  enrollments: AdminQueueSection<EnrollmentRow>;
  leave: AdminQueueSection<LeaveRow>;
  invoices: AdminQueueSection<InvoiceRow>;
  payroll: AdminQueueSection<PayrollRow>;
};

const leaveTypeLabel: Record<string, string> = {
  ANNUAL: "Tahunan",
  SICK: "Sakit",
  PERMISSION: "Izin",
  OTHER: "Lainnya",
};

/** Converts tenant-scoped domain records into navigation-only queue rows. */
export function buildAdminWorkQueue(sources: AdminQueueSources): AdminWorkItem[] {
  const items: AdminWorkItem[] = [];
  if (sources.inquiries.status === "ready") {
    items.push(...sources.inquiries.records.map((row) => ({
      id: `inquiry:${row.id}`,
      kind: "inquiry" as const,
      title: `Tindak lanjuti pertanyaan ${admissionChildLabel(row.childName)}`,
      description: `Dari ${row.parentName} · masuk ${formatDateShort(row.createdAt)}`,
      href: "/admin/admissions",
      state: "INQUIRY",
      recordId: row.id,
      actionLabel: "Buka pendaftaran",
      timeLabel: `Masuk ${formatDateShort(row.createdAt)}`,
      sortDate: row.createdAt,
    })));
  }
  if (sources.enrollments.status === "ready") {
    items.push(...sources.enrollments.records.map((row) => ({
      id: `enrollment:${row.id}`,
      kind: "enrollment" as const,
      title: `Tinjau formulir ${row.childName}`,
      description: row.status === "SUBMITTED" ? "Formulir baru dikirim" : "Peninjauan belum selesai",
      href: `/admin/enrollments/${row.id}`,
      state: row.status,
      recordId: row.id,
      actionLabel: "Tinjau formulir",
      sortDate: row.updatedAt,
    })));
  }
  if (sources.leave.status === "ready") {
    items.push(...sources.leave.records.map((row) => ({
      id: `leave:${row.id}`,
      kind: "leave" as const,
      title: `Putuskan izin ${row.employee.nama}`,
      description: `${leaveTypeLabel[row.leaveType] ?? row.leaveType} · ${formatDateShort(row.startDate)}–${formatDateShort(row.endDate)}`,
      href: `/admin/leave-requests?requestId=${row.id}`,
      state: row.status,
      recordId: row.id,
      actionLabel: "Tinjau izin",
      timeLabel: `Mulai ${formatDateShort(row.startDate)}`,
      sortDate: row.startDate,
    })));
  }
  if (sources.invoices.status === "ready") {
    items.push(...sources.invoices.records.map((row) => ({
      id: `invoice:${row.id}`,
      kind: "invoice" as const,
      title: `Pulihkan link ${row.student.name}`,
      description: `${row.invoiceNumber} · ${row.periodLabel}`,
      href: `/admin/invoices/${row.id}`,
      state: row.status,
      recordId: row.invoiceNumber,
      actionLabel: "Buka tagihan",
      dueDate: row.dueDate,
      timeLabel: row.dueDate ? `Jatuh tempo ${formatDateShort(row.dueDate)}` : undefined,
      sortDate: row.dueDate,
    })));
  }
  if (sources.payroll.status === "ready") {
    items.push(...sources.payroll.records.map((row) => ({
      id: `payroll:${row.id}`,
      kind: "payroll" as const,
      title: "Tinjau draf penggajian",
      description: `${formatDateShort(row.periodStart)}–${formatDateShort(row.periodEnd)}`,
      href: `/admin/payroll/${row.id}`,
      state: row.status,
      recordId: row.id,
      actionLabel: "Tinjau draf",
      timeLabel: `Periode ${formatDateShort(row.periodStart)}–${formatDateShort(row.periodEnd)}`,
      sortDate: row.periodStart,
    })));
  }
  return items;
}

/**
 * Ranks work items so the most time-sensitive surface first: items carrying
 * a `sortDate` (invoice dueDate, leave startDate, payroll periodStart,
 * enrollment updatedAt) sort ascending ahead of items without one. Stable —
 * items sharing a rank (both dated, or both undated) keep their original
 * `buildAdminWorkQueue` order.
 */
export function rankUrgent(items: AdminWorkItem[]): AdminWorkItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.sortDate && b.item.sortDate) {
        const diff = a.item.sortDate.localeCompare(b.item.sortDate);
        return diff !== 0 ? diff : a.index - b.index;
      }
      if (a.item.sortDate) return -1;
      if (b.item.sortDate) return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

export type QueueSummaryItem = { kind: AdminWorkKind; status: "ready" | "unavailable"; count: number };

/** Per-kind counts for visible (non-hidden) sources, plus the grand total. Never reports a false zero for an unavailable source. */
export function summarizeQueue(sources: AdminQueueSources): { items: QueueSummaryItem[]; total: number } {
  const kinds: Array<[keyof AdminQueueSources, AdminWorkKind]> = [
    ["inquiries", "inquiry"],
    ["enrollments", "enrollment"],
    ["leave", "leave"],
    ["invoices", "invoice"],
    ["payroll", "payroll"],
  ];
  const items: QueueSummaryItem[] = [];
  let total = 0;
  for (const [key, kind] of kinds) {
    const section = sources[key];
    if (section.status === "hidden") continue;
    if (section.status === "unavailable") {
      items.push({ kind, status: "unavailable", count: 0 });
      continue;
    }
    items.push({ kind, status: "ready", count: section.count });
    total += section.count;
  }
  return { items, total };
}

export function unavailableAdminQueueSections(sources: AdminQueueSources): AdminWorkKind[] {
  return (Object.entries(sources) as Array<[keyof AdminQueueSources, AdminQueueSources[keyof AdminQueueSources]]>)
    .filter(([, section]) => section.status === "unavailable")
    .map(([key]) => key === "inquiries" ? "inquiry" : key === "enrollments" ? "enrollment" : key === "invoices" ? "invoice" : key);
}

export function adminWorkPermissions(session: { role: string; permissions?: string[] | null }) {
  const can = (permission: string) => hasPermission(session, permission);
  return {
    // Same door as the enrollment forms: whoever reviews admissions follows up the inquiries.
    inquiries: can("admissions.view") && can("admissions.edit"),
    enrollments: can("admissions.view") && can("admissions.edit"),
    leave: can("hr.view") && can("leave.view") && can("leave.approve"),
    invoices: can("invoices.view") && can("invoices.create"),
    payroll: can("hr.view") && can("payroll.view") && can("payroll.approve"),
  };
}

/** Activity cards reveal the same records as their destinations. */
export function canViewAdminActivity(session: { role: string; permissions?: string[] | null }, destination: string) {
  const can = (permission: string) => hasPermission(session, permission);
  if (!can("hr.view")) return false;
  if (destination.startsWith("/admin/payroll")) return can("payroll.view");
  if (destination.startsWith("/admin/leave")) return can("leave.view");
  if (destination.startsWith("/admin/invoices")) return can("invoices.view");
  if (destination.startsWith("/admin/admissions")) return can("admissions.view");
  if (destination.startsWith("/admin/classes")) return can("academic.view");
  return destination.startsWith("/admin/employees") && can("employees.view");
}
