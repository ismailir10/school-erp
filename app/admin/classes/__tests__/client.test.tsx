/**
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the classes list name cell
 * becomes a `DataTableLinkCell` link to the class detail page; the row's
 * `⋯` menu (edit / deactivate) stays via `DataTableRowActions`, but the
 * separate "Lihat" button is gone.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClassesClient } from "@/app/admin/classes/client";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const year = { id: "y1", name: "2026/2027", status: "ACTIVE", startDate: "2026-07-01", endDate: "2027-06-30" };

const classRow = {
  id: "c1",
  name: "TKIT A",
  capacity: 20,
  slotTemplate: "FULL_DAY",
  ageGroup: "A",
  status: "ACTIVE",
  campusId: "cp1",
  programId: "p1",
  academicYearId: "y1",
  classTrackId: "ct1",
  campus: { id: "cp1", name: "Taman Aster" },
  program: { id: "p1", code: "TK", name: "Taman Kanak-kanak" },
  academicYear: year,
  enrolledCount: 10,
  attendance7dPct: 90,
  todaySession: "Held" as const,
  health: "Sehat" as const,
  teachingAssignments: [],
};

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/config/campuses")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    if (url.includes("/api/programs")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    if (url.includes("/api/academic-years")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [year] }) } as Response);
    }
    if (url.includes("/api/admin/classes")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [classRow] }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("ClassesClient — name is the link (T7)", () => {
  it("renders the class name as a link to the detail page and drops the separate Lihat button", async () => {
    vi.stubGlobal("fetch", stubFetch());

    render(<ClassesClient canWrite={true} />);

    const nameLink = await screen.findByRole("link", { name: "TKIT A" });
    expect(nameLink).toHaveAttribute("href", "/admin/classes/c1");
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Aksi untuk TKIT A/ })).toBeInTheDocument();
    });
  });
});

// T2 (2026-09-27 admin-finish-standard) — the Kondisi column renders
// `<StatusBadge>` off the new STATUS_MAP health keys instead of a raw
// `<Badge>` + the standalone `healthTone()` helper.
describe("ClassesClient — Kondisi column (T2 StatusBadge migration)", () => {
  it("renders the row's health value on the shared StatusBadge tone", async () => {
    vi.stubGlobal("fetch", stubFetch());

    render(<ClassesClient canWrite={true} />);

    const badge = await screen.findByText("Sehat");
    expect(badge.className).toContain("status-present-subtle");
  });
});

describe("ClassesClient — empty class health (CORE-21)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a brand-new class as a neutral 'Belum ada siswa', not 'Kritis'", async () => {
    const emptyRow = { ...classRow, enrolledCount: 0, health: "Belum ada siswa" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/academic-years")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: [year] }) } as Response);
        }
        if (url.includes("/api/admin/classes")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: [emptyRow] }) } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
      }),
    );

    render(<ClassesClient canWrite={true} />);

    const badge = await screen.findByText("Belum ada siswa");
    expect(badge.className).toContain("bg-muted");
    expect(badge.className).not.toContain("status-absent");
    expect(screen.queryByText("Kritis")).not.toBeInTheDocument();
  });
});

// T3 (cycle 2026-09-27, admin-forms-rhf) — Tambah/Ubah Kelas migrated onto
// useZodForm + FormField + classFormSchema.
const campus = { id: "cp1", name: "Taman Aster", status: "ACTIVE" };
const program = { id: "p1", code: "TK", name: "Taman Kanak-kanak", status: "ACTIVE" };

function stubFetchWithDialog(overrides: { post?: unknown; postOk?: boolean } = {}) {
  const { post = { id: "c-2" }, postOk = true } = overrides;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/config/campuses")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [campus] }) } as Response);
    }
    if (url.includes("/api/programs")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [program] }) } as Response);
    }
    if (url.includes("/api/academic-years")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [year] }) } as Response);
    }
    if (url.includes("/api/admin/classes") && init?.method === "POST") {
      return Promise.resolve({ ok: postOk, status: postOk ? 201 : 400, json: async () => post } as Response);
    }
    if (url.includes("/api/admin/classes")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [classRow] }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function findPostCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find(([input, init]) => {
    const url = typeof input === "string" ? input : (input as { toString(): string }).toString();
    return url.includes("/api/admin/classes") && (init as RequestInit | undefined)?.method === "POST";
  });
}

describe("ClassesClient — Tambah Kelas dialog (T3 rhf migration)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks submit with empty required fields, showing inline errors and firing no POST", async () => {
    const fetchMock = stubFetchWithDialog();
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);

    await user.click(await screen.findByRole("button", { name: "Tambah Kelas" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Kelas" });

    await user.click(within(dialog).getByRole("button", { name: "Tambah Kelas" }));

    expect(await within(dialog).findByText("Kampus wajib dipilih")).toBeInTheDocument();
    expect(within(dialog).getByText("Program wajib dipilih")).toBeInTheDocument();
    expect(within(dialog).getByText("Nama kelas wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Kelompok usia wajib dipilih")).toBeInTheDocument();

    expect(findPostCall(fetchMock)).toBeUndefined();
  });

  it("submits the filled form as POST /api/admin/classes with the expected body", async () => {
    const fetchMock = stubFetchWithDialog();
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);

    await user.click(await screen.findByRole("button", { name: "Tambah Kelas" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Kelas" });

    await user.click(within(dialog).getByRole("combobox", { name: /Kampus/ }));
    await user.click(await screen.findByRole("option", { name: "Taman Aster" }));

    await user.click(within(dialog).getByRole("combobox", { name: /Program/ }));
    await user.click(await screen.findByRole("option", { name: /Taman Kanak-kanak/ }));

    await user.type(within(dialog).getByPlaceholderText("mis. TKIT A"), "TKIT Baru");

    await user.click(within(dialog).getByRole("combobox", { name: /Kelompok usia/ }));
    await user.click(await screen.findByRole("option", { name: /TK A/ }));

    await user.click(within(dialog).getByRole("button", { name: "Tambah Kelas" }));

    await waitFor(() => expect(findPostCall(fetchMock)).toBeTruthy());

    const [, postInit] = findPostCall(fetchMock)!;
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      campusId: "cp1",
      programId: "p1",
      academicYearId: "y1",
      name: "TKIT Baru",
      capacity: 20,
      slotTemplate: "FULL_DAY",
      ageGroup: "A",
    });
  });
});

// ADM-5 (cycle 2026-10-07, admin-core-guards) — the server refuses a capacity
// below the ACTIVE roster with a 409; the edit dialog must show it on the
// Kapasitas field, not as a toast-only failure.
describe("ClassesClient — Ubah Kelas capacity guard (ADM-5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the server's 409 inline on the Kapasitas field", async () => {
    const message = "Kapasitas tidak bisa lebih kecil dari jumlah siswa aktif (2 siswa).";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/admin/classes/c1") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: message,
            field: "capacity",
            errors: [{ field: "capacity", message }],
          }),
        } as Response);
      }
      if (url.includes("/api/academic-years")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [year] }) } as Response);
      }
      if (url.includes("/api/admin/classes")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [classRow] }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);

    await user.click(await screen.findByRole("button", { name: /Aksi untuk TKIT A/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Ubah|Edit/ }));
    const dialog = await screen.findByRole("dialog", { name: /Ubah Kelas/ });

    const capacity = within(dialog).getByLabelText(/Kapasitas/);
    await user.clear(capacity);
    await user.type(capacity, "1");
    await user.click(within(dialog).getByRole("button", { name: /Simpan/ }));

    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(capacity).toHaveAttribute("aria-invalid", "true");
  });
});

// R2-ADMIN-2 — ?yearId= seeds the selected year and stays in the URL.
describe("ClassesClient — yearId from the URL (R2-ADMIN-2)", () => {
  const planning = { id: "y2", name: "2027/2028", status: "PLANNING", startDate: "2027-07-12", endDate: "2028-07-09" };

  function stubTwoYears() {
    return vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/academic-years")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [planning, year] }) } as Response);
      }
      if (url.includes("/api/admin/classes")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    });
  }
  const classCalls = (f: ReturnType<typeof stubTwoYears>) =>
    f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/admin/classes"));

  it("loads the year named in initialYearId and writes it to the URL", async () => {
    const f = stubTwoYears();
    vi.stubGlobal("fetch", f);
    render(<ClassesClient canWrite={true} initialYearId="y2" />);
    await waitFor(() => expect(classCalls(f).some((u) => u.includes("yearId=y2"))).toBe(true));
    expect(classCalls(f).some((u) => u.includes("yearId=y1"))).toBe(false);
    expect(window.location.search).toContain("yearId=y2");
  });

  it("falls back to the default year when initialYearId is unknown", async () => {
    const f = stubTwoYears();
    vi.stubGlobal("fetch", f);
    render(<ClassesClient canWrite={true} initialYearId="nope" />);
    await waitFor(() => expect(classCalls(f).some((u) => u.includes("yearId=y1"))).toBe(true));
    expect(window.location.search).toContain("yearId=y1");
  });
});

// Cycle 2026-10-27-class-program-visibility (T3) — Program is editable in
// Ubah Kelas, previews the billing impact, and is only sent when changed.
describe("ClassesClient — Ubah Kelas program change", () => {
  const programB = { id: "p2", code: "TK-B", name: "TK B", status: "ACTIVE" };
  const impactBody = (over: Record<string, unknown> = {}) => ({
    academicYear: { id: "y1", name: "2026/2027" },
    activeStudents: 13,
    invoicedStudents: 0,
    blockedReason: null,
    current: { programId: "p1", programName: "Taman Kanak-kanak", fees: { total: 504000, lines: [{ label: "SPP Bulanan", amount: 504000 }] } },
    next: { programId: "p2", programName: "TK B", fees: { total: 499000, lines: [{ label: "SPP Bulanan", amount: 499000 }] } },
    ...over,
  });

  function stub(impact: unknown = impactBody()) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/program-impact")) {
        return Promise.resolve({ ok: true, json: async () => impact } as Response);
      }
      if (url.includes("/api/admin/classes/c1") && init?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: async () => ({ id: "c1" }) } as Response);
      }
      if (url.includes("/api/config/campuses")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [campus] }) } as Response);
      }
      if (url.includes("/api/programs")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [program, programB] }) } as Response);
      }
      if (url.includes("/api/academic-years")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [year] }) } as Response);
      }
      if (url.includes("/api/admin/classes")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [classRow] }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const patchBody = (f: ReturnType<typeof stub>) => {
    const call = f.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    return call ? JSON.parse((call[1] as RequestInit).body as string) : undefined;
  };

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: /Aksi untuk TKIT A/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Ubah|Edit/ }));
    return screen.findByRole("dialog", { name: /Ubah Kelas/ });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets the admin pick another program while Kampus stays locked", async () => {
    stub();
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);

    const dialog = await openEdit(user);

    expect(within(dialog).getByRole("combobox", { name: /Program/ })).toBeEnabled();
    expect(within(dialog).getByRole("combobox", { name: /Kampus/ })).toBeDisabled();
  });

  it("previews the billing impact of the chosen program and sends it with the save", async () => {
    const f = stub();
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);
    const dialog = await openEdit(user);

    await user.click(within(dialog).getByRole("combobox", { name: /Program/ }));
    await user.click(await screen.findByRole("option", { name: /TK B/ }));

    expect(await within(dialog).findByText(/Tagihan rutin per periode berubah/)).toHaveTextContent(
      "Rp 504.000 ke Rp 499.000 untuk 13 siswa aktif",
    );
    expect(f.mock.calls.some(([u]) => String(u).includes("/api/admin/classes/c1/program-impact?programId=p2"))).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(patchBody(f)).toBeTruthy());
    expect(patchBody(f)).toMatchObject({ programId: "p2", name: "TKIT A" });
  });

  it("does not send programId when the program was left alone", async () => {
    const f = stub();
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);
    const dialog = await openEdit(user);

    const capacity = within(dialog).getByLabelText(/Kapasitas/);
    await user.clear(capacity);
    await user.type(capacity, "25");
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(patchBody(f)).toBeTruthy());
    expect(patchBody(f)).not.toHaveProperty("programId");
    expect(f.mock.calls.some(([u]) => String(u).includes("/program-impact"))).toBe(false);
  });

  it("disables Simpan and shows why when the students are already invoiced", async () => {
    const reason = "Program tidak bisa diubah karena 3 siswa di kelas ini sudah punya tagihan tahun ajaran ini.";
    stub(impactBody({ invoicedStudents: 3, blockedReason: reason }));
    const user = userEvent.setup();
    render(<ClassesClient canWrite={true} />);
    const dialog = await openEdit(user);

    await user.click(within(dialog).getByRole("combobox", { name: /Program/ }));
    await user.click(await screen.findByRole("option", { name: /TK B/ }));

    expect(await within(dialog).findByText(reason)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
  });
});
