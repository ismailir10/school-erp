/**
 * Increment 3 — the aggregate route and the two sections it unlocks.
 *
 * What is worth pinning:
 *  - the overview fetch is eager (the Kehadiran and Raport rail tiles read it)
 *    and Akademik / Pendaftaran stay silent until opened;
 *  - a failed overview renders a dash, never a zero — the same rule increment 2
 *    established for the Tunggakan tile, for the same reason;
 *  - the Pendaftaran section exists only for a student who came from a form;
 *  - `#akademik` in the URL opens and reaches that section.
 *
 * `ClassSectionCombobox` and `ResizeObserver` are stubbed for the reasons
 * spelled out in `page.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  enrollments: [
    {
      id: "e1",
      enrollDate: "2025-07-14",
      status: "ACTIVE",
      classSection: {
        id: "cs1",
        name: "TKIT B",
        program: { name: "TKIT", code: "TKIT", type: "SEMESTER" },
        academicYear: { name: "2025/2026", status: "ACTIVE" },
        campus: { name: "Taman Aster" },
      },
    },
  ],
};

const OVERVIEW = {
  finance: {
    invoiceCount: 2,
    byStatus: [
      { status: "OVERDUE", count: 1, totalDue: 500000, totalPaid: 100000, balance: 400000 },
      { status: "PAID", count: 1, totalDue: 500000, totalPaid: 500000, balance: 0 },
    ],
  },
  attendance: {
    month: "2026-08",
    counts: { present: 15, absent: 2, sick: 1, permission: 0, total: 18 },
  },
  penilaian: {
    term: { id: "tw2", label: "TW2 · Sem 1 · 2025/2026" },
    entryCount: 5,
    indicatorsAssessed: 2,
    indicatorsTotal: 10,
    coveragePct: 20,
  },
  raport: {
    published: 1,
    draft: 1,
    total: 4,
    current: { termId: "tw2", label: "TW2 · Sem 1 · 2025/2026", status: "DRAFT" },
  },
  documents: { photo: false, kk: false, ktpPresent: 0, ktpTotal: 0, consent: true },
  enrollmentApplication: { id: "app1", status: "ACCEPTED", submittedAt: "2026-05-02T03:00:00.000Z" },
};

const ACADEMICS = {
  data: {
    ageGroup: "B",
    currentTermId: "tw2",
    tally: { published: 1, draft: 1, total: 2 },
    rows: [
      {
        term: { id: "tw2", number: 2, semesterNumber: 1, academicYear: "2025/2026" },
        label: "TW2 · Sem 1 · 2025/2026",
        status: "DRAFT",
        publishedAt: null,
        updatedAt: null,
        penilaian: { entryCount: 5, indicatorsAssessed: 2, indicatorsTotal: 10, coveragePct: 20 },
      },
      {
        term: { id: "tw1", number: 1, semesterNumber: 1, academicYear: "2025/2026" },
        label: "TW1 · Sem 1 · 2025/2026",
        status: "PUBLISHED",
        publishedAt: "2025-10-05T00:00:00.000Z",
        updatedAt: null,
        penilaian: { entryCount: 30, indicatorsAssessed: 9, indicatorsTotal: 10, coveragePct: 90 },
      },
    ],
  },
};

const APPLICATION = {
  data: {
    id: "app1",
    status: "ACCEPTED",
    childName: "Aisyah Putri",
    parentEmail: "ibu@example.com",
    dcareAddon: false,
    submittedAt: "2026-05-02T03:00:00.000Z",
    studentData: { childName: "Aisyah Putri", foodAllergy: "telur dan udang", homeLanguage: "Indonesia" },
    ayahData: { name: "Umar Ramadhan", employerName: "PT Contoh" },
    ibuData: { name: "Fatimah Zahra" },
    consentData: { agreed: true, version: "v1", ayah: { name: "Umar Ramadhan", hasSignature: true } },
    documents: {
      kk: {
        hasFile: true,
        fileName: "kk-aisyah.pdf",
        mimeType: "application/pdf",
        size: 1000,
        uploadedAt: "2026-05-01T00:00:00.000Z",
        receivedPhysical: false,
        receivedAt: null,
      },
    },
    canEditDocuments: true,
    program: { id: "p1",
    canEdit: true, name: "TKIT" },
    admission: { id: "adm1", parentName: "Umar Ramadhan", parentPhone: "0812", parentRelationship: "AYAH" },
  },
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

type Calls = { url: string; method: string }[];

function stubFetch(
  over: { overviewStatus?: number; overview?: unknown; invoices?: unknown[] } = {},
) {
  const calls: Calls = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET" });

    if (url === "/api/students/s1/overview") {
      const status = over.overviewStatus ?? 200;
      return Promise.resolve({
        ok: status < 300,
        status,
        json: async () => over.overview ?? OVERVIEW,
      } as Response);
    }
    if (url === "/api/students/s1/academics") {
      return Promise.resolve({ ok: true, json: async () => ACADEMICS } as Response);
    }
    if (url === "/api/students/s1/enrollment-application") {
      return Promise.resolve({ ok: true, json: async () => APPLICATION } as Response);
    }
    if (url.startsWith("/api/invoices")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: over.invoices ?? [] }) } as Response);
    }
    if (url === "/api/students/s1") {
      return Promise.resolve({ ok: true, json: async () => student } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
  return { fn, calls };
}

const urlsMatching = (calls: Calls, needle: string) => calls.filter((c) => c.url.includes(needle));

// Retries rather than reading the DOM once. The `waitFor` the callers run
// first only proves the overview fetch was *issued* — `calls` is appended
// synchronously inside the stub — not that the response resolved and React
// committed the render that creates this trigger. A bare querySelector there
// is a race, and it is the one that failed CI on 2026-09-09 with
// `no disclosure trigger for section "akademik"` while passing on an idle
// machine. No explicit timeout: testing-library's configured asyncUtilTimeout
// owns that ceiling (see CLAUDE.md § Vitest).
async function sectionTrigger(sectionId: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = document.querySelector<HTMLElement>(`[aria-controls="${sectionId}-content"]`);
    if (!el) throw new Error(`no disclosure trigger for section "${sectionId}"`);
    return el;
  });
}

/**
 * The groups that hold the lazy rows (Kelas & Akademik, Pendaftaran & Catatan)
 * start closed, so an admin opens the group before the row inside it.
 */
async function openGroup(groupId: string): Promise<void> {
  const trigger = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(`[aria-controls="${groupId}-content"]`);
    if (!el) throw new Error(`no disclosure trigger for group "${groupId}"`);
    return el;
  });
  if (trigger.getAttribute("aria-expanded") !== "true") await userEvent.click(trigger);
}

describe("student dossier — increment 3", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    window.location.hash = "";
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("fetches the overview aggregate on load, alongside the student", async () => {
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));
  });

  it("fills the Kehadiran and Raport tiles increments 1 and 2 left out", async () => {
    const { fn } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("15/18").length).toBeGreaterThan(0));
    expect(screen.getAllByText("2 alpa · 1 sakit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1/4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 draf").length).toBeGreaterThan(0);
  });

  it("does not say a raport was issued when none was", async () => {
    // Found in smoke on a student with 1 term and no raport: the hint read
    // "terbit" next to "0/1", which says the opposite of the truth.
    const { fn } = stubFetch({
      overview: { ...OVERVIEW, raport: { published: 0, draft: 0, total: 1, current: null } },
    });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("0/1").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Belum ada rapor").length).toBeGreaterThan(0);
    expect(screen.queryByText("terbit")).not.toBeInTheDocument();
  });

  it("says so rather than showing 0 when the month has no attendance yet", async () => {
    const { fn } = stubFetch({
      overview: { ...OVERVIEW, attendance: { month: "2026-08", counts: { present: 0, absent: 0, sick: 0, permission: 0, total: 0 } } },
    });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() =>
      expect(screen.getAllByText("Belum ada absensi bulan ini").length).toBeGreaterThan(0),
    );
    // "0/0" would read as a real answer; the tile shows a dash instead.
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
  });

  it("renders a dash, never a zero, when the overview fetch fails", async () => {
    const { fn } = stubFetch({ overviewStatus: 500 });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("Aisyah Putri").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText("Memuat…")).not.toBeInTheDocument());
    expect(screen.queryByText("15/18")).not.toBeInTheDocument();
    expect(screen.queryByText("1/4")).not.toBeInTheDocument();
  });

  it("does not request academics or the pendaftaran form until those sections open", async () => {
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));
    expect(urlsMatching(calls, "/academics")).toHaveLength(0);
    expect(urlsMatching(calls, "/enrollment-application")).toHaveLength(0);
  });

  it("loads academics on first open and does not re-request on a second open", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));

    await openGroup("group-kelas");
    const trigger = await sectionTrigger("akademik");
    await user.click(trigger);

    await waitFor(() => expect(urlsMatching(calls, "/academics")).toHaveLength(1));
    await waitFor(() => expect(screen.getByText("TW1 · Sem 1 · 2025/2026")).toBeInTheDocument());
    expect(screen.getByText(/9\/10 indikator \(90%\)/)).toBeInTheDocument();

    await user.click(trigger);
    await user.click(trigger);
    expect(urlsMatching(calls, "/academics")).toHaveLength(1);
  });

  it("deep-links each raport row at the student's own term and class", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));

    await openGroup("group-kelas");
    await user.click(await sectionTrigger("akademik"));
    await waitFor(() => expect(screen.getByText("TW1 · Sem 1 · 2025/2026")).toBeInTheDocument());

    const link = screen.getAllByRole("link", { name: /Buka raport/ })[0];
    expect(link).toHaveAttribute("href", expect.stringContaining("termId=tw2"));
    expect(link).toHaveAttribute("href", expect.stringContaining("studentId=s1"));
    expect(link).toHaveAttribute("href", expect.stringContaining("classSectionId=cs1"));
  });

  it("shows the pendaftaran form for a converted student, lazily", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("pendaftaran"));

    await waitFor(() => expect(urlsMatching(calls, "/enrollment-application")).toHaveLength(1));
    // Data the convert route never copied onto the Student or Parent rows.
    await waitFor(() => expect(screen.getByText("PT Contoh")).toBeInTheDocument());
    expect(screen.getByAltText("Tanda tangan ayah")).toHaveAttribute(
      "src",
      "/api/enrollments/app1/signature?which=ayah",
    );
  });

  it("shows the Kelengkapan Berkas card inside the pendaftaran section", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("pendaftaran"));

    await waitFor(() => expect(screen.getByText("kk-aisyah.pdf")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Lihat Kartu Keluarga (KK)" })).toHaveAttribute(
      "href",
      "/api/enrollments/app1/documents/kk",
    );
    // canEditDocuments: the physical-receipt tick is live.
    expect(screen.getByRole("checkbox", { name: "Diterima fisik: KTP Ayah" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("hides the Kelengkapan Berkas card when the API withholds documents", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    const wrapped = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/students/s1/enrollment-application") {
        calls.push({ url, method: "GET" });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { ...APPLICATION.data, documents: null, canEditDocuments: false },
          }),
        } as Response);
      }
      return fn(input, init);
    });
    vi.stubGlobal("fetch", wrapped);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("pendaftaran"));

    // The rest of the form still renders; only the card is withheld.
    await waitFor(() => expect(screen.getByText("PT Contoh")).toBeInTheDocument());
    // The card's own heading id; the rail's "Kelengkapan Berkas" checklist is a different card.
    expect(document.getElementById("kelengkapan-berkas-title")).toBeNull();
    expect(screen.queryByText("kk-aisyah.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Diterima fisik/ })).not.toBeInTheDocument();
  });

  it("locks the receipt ticks when the viewer cannot edit documents", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    const wrapped = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/students/s1/enrollment-application") {
        calls.push({ url, method: "GET" });
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ...APPLICATION.data, canEditDocuments: false } }),
        } as Response);
      }
      return fn(input, init);
    });
    vi.stubGlobal("fetch", wrapped);
    render(<StudentDetailPage />);
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("pendaftaran"));

    const tick = await screen.findByRole("checkbox", { name: "Diterima fisik: KTP Ayah" });
    expect(tick).toHaveAttribute("aria-disabled", "true");
  });

  it("names the unfinished paper-form checklist in Perlu perhatian for a converted student", async () => {
    const { fn } = stubFetch({
      overview: {
        ...OVERVIEW,
        documents: { ...OVERVIEW.documents, enrollment: { done: 6, required: 9 } },
      },
    });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    const strip = await screen.findByRole("region", { name: "Perlu perhatian" });
    await waitFor(() => expect(within(strip).getByText(/Berkas pendaftaran \(6 \/ 9\)/)).toBeInTheDocument());
  });

  it("refreshes the Perlu perhatian count after a Diterima fisik tick is saved", async () => {
    const user = userEvent.setup();
    let done = 6;
    const { fn, calls } = stubFetch();
    const wrapped = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/students/s1/overview") {
        calls.push({ url, method: "GET" });
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...OVERVIEW,
            documents: { ...OVERVIEW.documents, enrollment: { done, required: 9 } },
          }),
        } as Response);
      }
      if (url === "/api/enrollments/app1" && init?.method === "PATCH") {
        done = 7;
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }
      return fn(input, init);
    });
    vi.stubGlobal("fetch", wrapped);
    render(<StudentDetailPage />);
    const strip = await screen.findByRole("region", { name: "Perlu perhatian" });
    await waitFor(() => expect(within(strip).getByText(/Berkas pendaftaran \(6 \/ 9\)/)).toBeInTheDocument());

    await openGroup("group-catatan");
    await user.click(await sectionTrigger("pendaftaran"));
    await user.click(await screen.findByRole("checkbox", { name: "Diterima fisik: KTP Ayah" }));

    await waitFor(() => expect(within(strip).getByText(/Berkas pendaftaran \(7 \/ 9\)/)).toBeInTheDocument());
    expect(urlsMatching(calls, "/overview").length).toBeGreaterThanOrEqual(2);
  });

  it("omits the Berkas pendaftaran item when there is no application", async () => {
    const { fn } = stubFetch({
      overview: {
        ...OVERVIEW,
        documents: { ...OVERVIEW.documents, enrollment: null },
        enrollmentApplication: null,
      },
    });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("15/18").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Berkas pendaftaran/)).not.toBeInTheDocument();
  });

  it("omits the pendaftaran section entirely for a hand-entered student", async () => {
    const { fn } = stubFetch({ overview: { ...OVERVIEW, enrollmentApplication: null } });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("15/18").length).toBeGreaterThan(0));
    expect(document.querySelector('[aria-controls="pendaftaran-content"]')).toBeNull();
    expect(screen.queryByText("Formulir Pendaftaran")).not.toBeInTheDocument();
  });

  it("opens the section named in the URL hash", async () => {
    window.location.hash = "#akademik";
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    // The browser's own hash scroll fires before the section exists and lands
    // on nothing while it is collapsed — honouring the hash is what makes a
    // link into the dossier work.
    await waitFor(() => expect(urlsMatching(calls, "/academics")).toHaveLength(1));
  });

  it("shows the per-status invoice breakdown from the aggregate", async () => {
    const { fn } = stubFetch({ invoices: INVOICES });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    // The four figures above it are totals; this line is the shape of the
    // problem — "1 lewat tempo · Rp 400.000" next to "1 lunas".
    const chipText = async () =>
      screen
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace(/\s+/g, " ").trim() ?? "");

    await waitFor(async () =>
      expect(await chipText()).toEqual(
        expect.arrayContaining(["1 lewat tempo · Rp 400.000", "1 lunas"]),
      ),
    );
  });

  it("tolerates an overview body that is not the expected shape", async () => {
    // A 200 carrying a proxy error page must degrade to the dash, not throw
    // the dossier away.
    const { fn } = stubFetch({ overview: {} });
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("Aisyah Putri").length).toBeGreaterThan(0));
    expect(screen.queryByText("15/18")).not.toBeInTheDocument();
  });
});
