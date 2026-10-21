/**
 * Increment 2 — the three sections the student dossier gained over routes that
 * already accept a `studentId`: Keuangan, Keringanan, Buku Penghubung.
 *
 * The contracts worth pinning are about *when* each one costs a request, and
 * about the money figure agreeing with the summary lib. Keuangan is eager
 * because the rail's Tunggakan tile reads it; the other two must stay silent
 * until an admin opens them, or the dossier pays three round-trips per student
 * view for data most visits never look at.
 *
 * `ClassSectionCombobox` and `ResizeObserver` are stubbed for the same reasons
 * spelled out in `page.test.tsx` — cmdk needs a ResizeObserver jsdom does not
 * have, and neither is under test here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const student = {
  id: "s1",
    canEdit: true,
  name: "Aisyah Putri",
  nickname: null,
  dateOfBirth: "2021-01-15",
  gender: null,
  address: null,
  notes: null,
  metadata: null,
  status: "ACTIVE",
  nis: null,
  nisn: null,
  birthPlace: null,
  nik: null,
  kkNumber: null,
  livingWith: null,
  photoUrl: null,
  createdAt: null,
  withdrawalReason: null,
  withdrawalDate: null,
  graduationDate: null,
  guardians: [],
  enrollments: [],
};

const INVOICES = [
  {
    id: "inv-1",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "2026-01",
    dueDate: "2026-01-31",
    status: "PAID",
    totalDue: "500000.00",
    totalPaid: "500000.00",
  },
  {
    id: "inv-2",
    invoiceNumber: "INV-2026-0002",
    periodLabel: "2026-02",
    dueDate: "2026-02-28",
    status: "OVERDUE",
    totalDue: "500000.00",
    totalPaid: "100000.00",
  },
];

const ADJUSTMENTS = [
  {
    id: "adj-1",
    type: "DISCOUNT",
    mode: "PERCENT",
    value: "25",
    reason: "Anak kedua",
    validFrom: null,
    validTo: null,
    status: "ACTIVE",
    feeComponent: { label: "SPP Bulanan" },
    academicYear: { name: "2025/2026" },
  },
];

type Calls = { url: string; method: string }[];

/** Records every request the page makes, so laziness is assertable. */
function stubFetch(
  over: {
    invoices?: unknown;
    invoiceStatus?: number;
    schoolCategories?: unknown[];
    schoolEntries?: unknown[];
  } = {},
) {
  const calls: Calls = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET" });

    if (url.startsWith("/api/invoices")) {
      const status = over.invoiceStatus ?? 200;
      return Promise.resolve({
        ok: status < 300,
        status,
        json: async () => ({ data: over.invoices ?? INVOICES }),
      } as Response);
    }
    if (url.startsWith("/api/student-fee-adjustments")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: ADJUSTMENTS }) } as Response);
    }
    if (url.includes("/api/student-journal/admin/students") && url.includes("/week?weekStart=")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            weekStart: "2026-08-17",
            dates: ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
            schoolCategories: over.schoolCategories ?? [
              { id: "c1", name: "Ibadah", scope: "SCHOOL", indicators: [{ id: "i1", label: "Sholat", order: 1 }] },
            ],
            homeCategories: [],
            schoolEntries: over.schoolEntries ?? [
              { id: "e1", indicatorId: "i1", date: "2026-08-17", checked: true },
            ],
            homeEntries: [],
          },
        }),
      } as Response);
    }
    // `NoteThreadPanel` (used by both the dossier's Buku Penghubung card and
    // the full journal detail page) reads the whole thread from here, not
    // from the week payload — that is exactly the bug this cycle fixes.
    if (url.startsWith("/api/student-journal/notes/read")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { lastReadAt: "x" } }) } as Response);
    }
    if (url.startsWith("/api/student-journal/notes")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            notes: [
              {
                id: "n1",
                date: "2026-08-18",
                authorRole: "TEACHER",
                authorName: "Bu Rina",
                body: "Ceria hari ini",
                createdAt: "2026-08-18T03:00:00.000Z",
              },
            ],
            nextCursor: null,
            unreadCount: 0,
          },
        }),
      } as Response);
    }
    if (url === "/api/students/s1") {
      return Promise.resolve({ ok: true, json: async () => student } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
  return { fn, calls };
}

const urlsMatching = (calls: Calls, needle: string) =>
  calls.filter((c) => c.url.includes(needle));

/**
 * The section's own disclosure trigger. Every section label appears twice —
 * once in `DossierNav`, once on the `CollapsibleTrigger` — and only the
 * trigger toggles, so a plain name query is ambiguous and would pick the nav
 * button, which opens but never closes.
 */
// Staging moved the lookup to the section's data-slot trigger (the markup the
// guardian work introduced); this keeps that selector and re-adds the retry.
// The `waitFor` the callers run first only proves the fetch was *issued*, not
// that React committed the render that creates this trigger, so a one-shot
// read is a race — the one that failed CI on 2026-09-09 in the twin suite.
async function sectionTrigger(sectionId: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const section = document.getElementById(sectionId);
    const el = section?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    if (!el) throw new Error(`no disclosure trigger for section "${sectionId}"`);
    return el;
  });
}

/** Buku Penghubung sits in Pendaftaran & Catatan, which starts closed. */
async function openGroup(groupId: string): Promise<void> {
  const trigger = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(`[aria-controls="${groupId}-content"]`);
    if (!el) throw new Error(`no disclosure trigger for group "${groupId}"`);
    return el;
  });
  if (trigger.getAttribute("aria-expanded") !== "true") await userEvent.click(trigger);
}

describe("student dossier — increment 2 sections", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("fetches invoices on load and scopes the request to this student", async () => {
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(urlsMatching(calls, "/api/invoices")).toHaveLength(1));
    expect(urlsMatching(calls, "/api/invoices")[0].url).toContain("studentId=s1");
  });

  it("shows outstanding by the shared unpaid rule, not the raw billed total", async () => {
    const { fn } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    // Billed 1.000.000, paid 600.000 — but only the OVERDUE invoice's 400.000
    // is owed; the PAID one contributes nothing.
    await waitFor(() => {
      expect(screen.getAllByText("Rp 400.000").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("1 tagihan belum lunas · 28 Feb 2026")).toBeInTheDocument();
  });

  it("says Lunas semua when nothing is owed", async () => {
    const { fn } = stubFetch({ invoices: [INVOICES[0]] });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getByText("Lunas semua")).toBeInTheDocument());
  });

  it("renders a dash rather than Rp 0 when the invoice fetch fails", async () => {
    // Rp 0 would be indistinguishable from "paid up" — the one reading an
    // admin must not be given by mistake.
    const { fn } = stubFetch({ invoiceStatus: 500 });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() =>
      expect(screen.getByText("Gagal memuat data tagihan.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Lunas semua")).not.toBeInTheDocument();
  });

  it("does not request keringanan or the journal until their sections are opened", async () => {
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(urlsMatching(calls, "/api/invoices")).toHaveLength(1));
    expect(urlsMatching(calls, "/api/student-fee-adjustments")).toHaveLength(0);
    expect(urlsMatching(calls, "/api/student-journal/")).toHaveLength(0);
  });

  it("loads keringanan on first open and does not re-request on a second open", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/api/invoices")).toHaveLength(1));

    const trigger = await sectionTrigger("keringanan");
    await user.click(trigger);

    await waitFor(() =>
      expect(urlsMatching(calls, "/api/student-fee-adjustments")).toHaveLength(1),
    );
    expect(urlsMatching(calls, "/api/student-fee-adjustments")[0].url).toContain("studentId=s1");
    await waitFor(() => expect(screen.getByText(/Diskon 25%/)).toBeInTheDocument());

    // Collapse, expand again — still one request.
    await user.click(trigger);
    await user.click(trigger);
    expect(urlsMatching(calls, "/api/student-fee-adjustments")).toHaveLength(1);
  });

  it("loads the journal week on first open of Buku Penghubung", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/api/invoices")).toHaveLength(1));

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("buku-penghubung"));

    await waitFor(() =>
      expect(urlsMatching(calls, "/api/student-journal/admin/students/s1/week")).toHaveLength(1),
    );
    await waitFor(() => expect(screen.getByText("Ceria hari ini")).toBeInTheDocument());
    expect(screen.getByText("1/5 hari terisi · 1 centang")).toBeInTheDocument();
  });

  it("shows the staff empty-week copy on the Buku Penghubung grid when no cell is checked", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch({
      schoolEntries: [{ id: "e1", indicatorId: "i1", date: "2026-08-17", checked: false }],
    });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/api/invoices")).toHaveLength(1));

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("buku-penghubung"));

    await waitFor(() =>
      expect(urlsMatching(calls, "/api/student-journal/admin/students/s1/week")).toHaveLength(1),
    );
    expect(await screen.findByText("Belum ada centang di pekan ini.")).toBeInTheDocument();
  });
});
