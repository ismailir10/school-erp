/**
 * Shared fixtures for the student page suites written for the five-group
 * dossier (groups, header by state, attention strip, family contact, rail).
 * The older suites keep their own inline copies on purpose: they pin
 * behaviour that predates this file and are updated in place, not rewritten.
 */
import { vi } from "vitest";

type Guardian = {
  id: string;
  relationship: string;
  isPrimary: boolean;
  childOrder: number | null;
  status: string;
  parent: Record<string, unknown>;
};

export function makeGuardian(over: {
  id: string;
  name: string;
  relationship?: string;
  isPrimary?: boolean;
  status?: string;
  phone?: string | null;
  whatsapp?: string | null;
  hasKtp?: boolean;
  hasKk?: boolean;
}): Guardian {
  return {
    id: `sg-${over.id}`,
    relationship: over.relationship ?? "IBU",
    isPrimary: over.isPrimary ?? false,
    childOrder: null,
    status: over.status ?? "ACTIVE",
    parent: {
      id: over.id,
      name: over.name,
      phone: over.phone === undefined ? "081255501234" : over.phone,
      email: null,
      whatsapp: over.whatsapp === undefined ? over.phone ?? "081255501234" : over.whatsapp,
      nik: null,
      education: null,
      occupation: null,
      employer: null,
      employerAddress: null,
      employerCity: null,
      incomeRange: null,
      childrenTotal: null,
      address: null,
      hasKtp: over.hasKtp ?? true,
      hasKk: over.hasKk ?? true,
    },
  };
}

export const CLASS_ENROLLMENT = {
  id: "e1",
  enrollDate: "2026-07-14",
  status: "ACTIVE",
  classSection: {
    id: "cs1",
    name: "KB A",
    program: { name: "Kelompok Bermain", code: "KB", type: "SEMESTER" },
    academicYear: { name: "2026/2027", status: "ACTIVE" },
    campus: { name: "Taman Aster" },
  },
};

export function makeStudent(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    canEdit: true,
    name: "Aisyah Putri",
    nickname: "Aisyah",
    dateOfBirth: "2021-01-15",
    gender: "L",
    address: null,
    notes: null,
    metadata: JSON.stringify({ foodAllergy: "kacang" }),
    status: "ACTIVE",
    nis: "2026-0142",
    nisn: null,
    birthPlace: null,
    nik: null,
    kkNumber: null,
    livingWith: null,
    photoUrl: "photo.jpg",
    createdAt: "2026-07-01T00:00:00.000Z",
    withdrawalReason: null,
    withdrawalDate: null,
    graduationDate: null,
    guardians: [
      makeGuardian({ id: "p-ibu", name: "Fatimah Rahman", relationship: "IBU", isPrimary: true }),
      makeGuardian({ id: "p-ayah", name: "Hadi Rahman", relationship: "AYAH", phone: "081355508890" }),
    ],
    enrollments: [CLASS_ENROLLMENT],
    ...over,
  };
}

export const OVERVIEW = {
  finance: { invoiceCount: 2, byStatus: [] },
  attendance: { month: "2026-10", counts: { present: 18, absent: 0, sick: 1, permission: 1, total: 20 } },
  penilaian: null,
  raport: { published: 0, draft: 1, total: 2, current: null },
  documents: { photo: true, kk: true, ktpPresent: 2, ktpTotal: 2, consent: true, enrollment: null },
  enrollmentApplication: null as null | { id: string; status: string; submittedAt: string | null },
};

export const OVERVIEW_WITH_FORM = {
  ...OVERVIEW,
  documents: { ...OVERVIEW.documents, enrollment: { done: 6, required: 6 } },
  enrollmentApplication: { id: "app1", status: "ACCEPTED", submittedAt: "2026-09-12T03:00:00.000Z" },
};

export const ACADEMICS = {
  data: {
    ageGroup: "B",
    currentTermId: "tw1",
    tally: { published: 0, draft: 1, total: 2 },
    rows: [
      {
        term: { id: "tw1", number: 1, semesterNumber: 1, academicYear: "2026/2027" },
        label: "TW1 · Sem 1 · 2026/2027",
        status: "DRAFT",
        publishedAt: null,
        updatedAt: null,
        penilaian: { entryCount: 0, indicatorsAssessed: 0, indicatorsTotal: 10, coveragePct: 0 },
      },
    ],
  },
};

export const APPLICATION = {
  data: {
    id: "app1",
    status: "ACCEPTED",
    childName: "Aisyah Putri",
    parentEmail: "ibu@example.com",
    dcareAddon: false,
    submittedAt: "2026-09-12T03:00:00.000Z",
    studentData: { childName: "Aisyah Putri" },
    ayahData: { name: "Hadi Rahman", employerName: "PT Contoh" },
    ibuData: { name: "Fatimah Rahman" },
    consentData: { agreed: true, version: "v1", ayah: { name: "Hadi Rahman", hasSignature: true } },
    documents: null,
    canEditDocuments: false,
    program: { id: "p1", canEdit: true, name: "KB" },
    admission: { id: "adm1", parentName: "Hadi Rahman", parentPhone: "0812", parentRelationship: "AYAH" },
  },
};

export const INVOICES_OWED = [
  { id: "inv-1", invoiceNumber: "INV-1", periodLabel: "2026-09", dueDate: "2026-10-10", status: "OVERDUE", totalDue: "750000", totalPaid: "0" },
  { id: "inv-2", invoiceNumber: "INV-2", periodLabel: "2026-10", dueDate: "2026-10-31", status: "SENT", totalDue: "500000", totalPaid: "0" },
  { id: "inv-3", invoiceNumber: "INV-3", periodLabel: "2026-08", dueDate: "2026-08-31", status: "PAID", totalDue: "750000", totalPaid: "750000" },
];

export type Calls = { url: string; method: string }[];

export type FetchOptions = {
  student?: unknown;
  invoices?: unknown[];
  invoiceStatus?: number;
  /** `null` = the overview request fails. */
  overview?: unknown | null;
  adjustments?: unknown[];
};

/** Records every request, so "fetches nothing until opened" is assertable. */
export function stubFetch(opts: FetchOptions = {}) {
  const calls: Calls = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET" });
    const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);

    if (url === "/api/students/s1") return ok(opts.student ?? makeStudent());
    if (url === "/api/students/s1/overview") {
      if (opts.overview === null) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
      return ok(opts.overview ?? OVERVIEW);
    }
    if (url.startsWith("/api/invoices")) {
      const status = opts.invoiceStatus ?? 200;
      return Promise.resolve({ ok: status < 300, status, json: async () => ({ data: opts.invoices ?? [] }) } as Response);
    }
    if (url === "/api/students/s1/academics") return ok(ACADEMICS);
    if (url === "/api/students/s1/enrollment-application") return ok(APPLICATION);
    if (url.startsWith("/api/student-fee-adjustments")) return ok({ data: opts.adjustments ?? [] });
    if (url.startsWith("/api/student-journal/admin/students")) {
      return ok({
        data: {
          weekStart: "2026-10-12",
          dates: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"],
          schoolCategories: [],
          homeCategories: [],
          schoolEntries: [],
          homeEntries: [],
        },
      });
    }
    if (url.startsWith("/api/student-journal/notes")) {
      return ok({ data: { notes: [], nextCursor: null, unreadCount: 0 } });
    }
    return ok({});
  });
  return { fn, calls };
}

export const urlsMatching = (calls: Calls, needle: string) => calls.filter((c) => c.url.includes(needle));

export class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
