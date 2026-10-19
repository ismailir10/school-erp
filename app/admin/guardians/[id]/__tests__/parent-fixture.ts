/**
 * Shared fixture for the wali detail page tests: the GET /api/parents/[id]
 * payload shape plus the `use(params)` helper every page test needs.
 */
import { vi } from "vitest";

export function fulfilledParams(value: { id: string }): Promise<{ id: string }> {
  // `use(params)` suspends on a cold promise; pre-attach the fulfilled marker
  // React sets so it reads synchronously, as Next does for route params.
  const p = Promise.resolve(value) as Promise<{ id: string }> & { status?: string; value?: { id: string } };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

export type ParentFixture = ReturnType<typeof makeParent>;

export function makeParent(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    canEdit: true,
    canRemind: true,
    name: "Ibu Siti Aminah",
    email: "siti@example.test",
    phone: "081234567890",
    whatsapp: "081234567890",
    address: "Jl. Melati No. 1",
    nik: "3201010101010001",
    education: "S1",
    occupation: "Guru",
    employer: "SDN 1",
    employerAddress: null,
    employerCity: "Bandung",
    incomeRange: "5-10 juta",
    childrenTotal: 2,
    hasKtp: true,
    hasKk: false,
    status: "ACTIVE",
    invoiceSummary: {
      invoiceCount: 1,
      totalBilled: 500000,
      totalPaid: 100000,
      outstanding: 400000,
      unpaidCount: 1,
      nearestDue: "2026-01-10T00:00:00.000Z",
      overdueCount: 1,
    },
    guardians: [
      {
        id: "sg-1",
        relationship: "IBU",
        isPrimary: true,
        status: "ACTIVE",
        outstanding: 400000,
        student: { id: "s1", name: "Ahmad Fajar", status: "ACTIVE", gender: "L", className: "KB A" },
      },
    ],
    invoices: [
      {
        id: "inv-1",
        invoiceNumber: "INV-2026-0001",
        periodLabel: "2026-01",
        totalDue: 500000,
        totalPaid: 100000,
        status: "OVERDUE",
        dueDate: "2026-01-10T00:00:00.000Z",
        studentId: "s1",
        studentName: "Ahmad Fajar",
      },
    ],
    unpaidInvoices: [
      { id: "inv-1", invoiceNumber: "INV-2026-0001", periodLabel: "2026-01", studentName: "Ahmad Fajar", remaining: 400000 },
    ],
    ...overrides,
  };
}

/** A parent with nothing owed, both documents on file and no children. */
export const CLEAN_SUMMARY = {
  invoiceCount: 0,
  totalBilled: 0,
  totalPaid: 0,
  outstanding: 0,
  unpaidCount: 0,
  nearestDue: null,
  overdueCount: 0,
};

export function okJson(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

export function stubFetchWith(parent: unknown) {
  const fn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method && init.method !== "GET" ? okJson({ success: true }) : okJson(parent),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
