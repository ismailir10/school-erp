/**
 * /admin/fees — Komponen Biaya redesign (cycle 2026-09-26-admin-ui-standard-c1,
 * T5). Covers: tab labels, the Komponen Biaya deactivate ConfirmDialog and its
 * consequence copy, Tarif per Program's active-program/active-year defaults,
 * an inactive-but-stored component rendering as a muted read-only row, and
 * the "Simpan Tarif" dirty-state gate + "Ada perubahan belum disimpan"
 * indicator.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import FeesPage from "../page";

const COMPONENTS = [
  { id: "fc-spp", code: "spp", label: "SPP Bulanan", category: "TUITION", isRecurring: true, isEnabled: true, sortOrder: 1 },
  { id: "fc-pangkal", code: "uang_pangkal", label: "Uang Pangkal", category: "REGISTRATION", isRecurring: false, isEnabled: false, sortOrder: 2 },
];

const PROGRAMS = [
  { id: "prog-inactive", code: "AAA", name: "Program Lama", status: "INACTIVE" },
  { id: "prog-active", code: "BBB", name: "Program Aktif", status: "ACTIVE" },
];

const YEARS = [
  { id: "year-planning", name: "2024/2025", status: "PLANNING" },
  { id: "year-active", name: "2025/2026", status: "ACTIVE" },
];

const STRUCTURES = [
  { id: "fs-1", feeComponentId: "fc-spp", amount: "500000", notes: null, feeComponent: COMPONENTS[0] },
  { id: "fs-2", feeComponentId: "fc-pangkal", amount: "250000", notes: null, feeComponent: COMPONENTS[1] },
];

// What GET /api/fee-bundles answers for the "Harga paket sekolah + daycare"
// section: the page's "Program Aktif" is the school program, "Day Care" the
// daycare one, and both price SPP.
const BUNDLE_DATA = {
  canEdit: true,
  programs: [
    { id: "prog-active", code: "BBB", name: "Program Aktif", type: "SEMESTER", status: "ACTIVE" },
    { id: "prog-day", code: "DCARE", name: "Day Care", type: "YEAR_ROUND", status: "ACTIVE" },
  ],
  components: [{ id: "fc-spp", code: "spp", label: "SPP Bulanan" }],
  programFees: [
    { programId: "prog-active", feeComponentId: "fc-spp", amount: 500000 },
    { programId: "prog-day", feeComponentId: "fc-spp", amount: 1000000 },
  ],
  bundles: [],
};
const BUNDLE_INPUT = "Harga paket SPP Bulanan, Program Aktif + Day Care";

// `withStructure: false` keeps `/api/programs` and `/api/academic-years`
// empty — used by tests that only exercise the Komponen Biaya tab, so the
// Tarif per Program tab's own default-selection effect (and the
// `fetchStructure()` fetch + re-render it triggers in the background) never
// fires. Without this, that unrelated re-render intermittently races the
// row-action dropdown's open transition in jsdom (flaky, not a real app bug).
function fixture({ withStructure = true }: { withStructure?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
    if (input.startsWith("/api/fee-components")) return { ok: true, json: async () => COMPONENTS };
    if (input.startsWith("/api/programs")) return { ok: true, json: async () => (withStructure ? PROGRAMS : []) };
    if (input.startsWith("/api/academic-years")) return { ok: true, json: async () => (withStructure ? YEARS : []) };
    if (input.startsWith("/api/fee-structure")) return { ok: true, json: async () => STRUCTURES };
    if (input.startsWith("/api/fee-bundles")) return { ok: true, status: 200, json: async () => BUNDLE_DATA };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("FeesPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the three tabs under their new labels", async () => {
    fixture();
    render(<FeesPage />);

    expect(await screen.findByRole("tab", { name: "Komponen Biaya" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tarif per Program" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Keringanan Siswa" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Biaya", level: 1 })).toBeInTheDocument();
  });

  it("Komponen Biaya: deactivate goes through a ConfirmDialog naming the consequence, not an immediate toggle", async () => {
    const fetchMock = fixture({ withStructure: false });
    const user = userEvent.setup();
    render(<FeesPage />);

    await screen.findByText("SPP Bulanan");
    // Queried directly by its accessible name (the row-action button's
    // `aria-label` already names the component, so there's no ambiguity)
    // rather than narrowed via `within(row)`.
    // userEvent (not fireEvent) drives the row-action dropdown: it's a Base
    // UI Menu, which opens via a real pointerdown/pointerup/click sequence
    // and mounts its content asynchronously — fireEvent.click alone is racy
    // against that mount (see components/ui/data-table-row-actions.tsx).
    await user.click(await screen.findByRole("button", { name: "Aksi untuk SPP Bulanan" }));
    await user.click(await screen.findByRole("menuitem", { name: "Nonaktifkan" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Nonaktifkan komponen ini?")).toBeInTheDocument();
    expect(within(dialog).getByText(/tidak akan ditambahkan lagi ke tagihan atau proses tagih baru/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Tagihan yang sudah dibuat tidak berubah/)).toBeInTheDocument();

    // No PUT fired yet — the ConfirmDialog gates the mutation.
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Nonaktifkan" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/fee-components/fc-spp" && (init as RequestInit).method === "PUT")).toBe(true);
    });
  });

  it("Tarif per Program: defaults to the active program and the active academic year", async () => {
    fixture();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Program" })).toHaveTextContent("Program Aktif");
      expect(screen.getByRole("combobox", { name: "Tahun Ajaran" })).toHaveTextContent("2025/2026");
    });
  });

  it("Tarif per Program: shows which classes use the selected program and year (Dipakai oleh)", async () => {
    const fetchMock = fixture();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));

    expect(await screen.findByRole("heading", { name: "Dipakai oleh" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).startsWith("/api/admin/classes?") &&
            String(url).includes("programId=prog-active") &&
            String(url).includes("yearId=year-active"),
        ),
      ).toBe(true),
    );
  });

  it("Tarif per Program: a deactivated component with a stored tarif shows as a muted, read-only Nonaktif row", async () => {
    fixture();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));

    expect(await screen.findByText("Uang Pangkal")).toBeInTheDocument();
    expect(screen.getByText("Nonaktif")).toBeInTheDocument();
    // Read-only: formatted text, not an editable RupiahInput, for the inactive row.
    expect(screen.getByText("Rp 250.000")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Tarif Uang Pangkal" })).not.toBeInTheDocument();
    // The active component stays editable.
    expect(screen.getByRole("textbox", { name: "Tarif SPP Bulanan" })).toHaveValue("500.000");
  });

  it("Tarif per Program: inactive status comes from the component list, not the stale nested structure snapshot", async () => {
    // Just-deactivated: /api/fee-components already says disabled, but the
    // previously fetched structure still embeds the pre-toggle status.
    const staleStructures = [
      STRUCTURES[0],
      { ...STRUCTURES[1], feeComponent: { ...COMPONENTS[1], isEnabled: true } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.startsWith("/api/fee-components")) return { ok: true, json: async () => COMPONENTS };
        if (input.startsWith("/api/programs")) return { ok: true, json: async () => PROGRAMS };
        if (input.startsWith("/api/academic-years")) return { ok: true, json: async () => YEARS };
        if (input.startsWith("/api/fee-structure")) return { ok: true, json: async () => staleStructures };
        if (input.startsWith("/api/fee-bundles")) return { ok: true, status: 200, json: async () => BUNDLE_DATA };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));

    expect(await screen.findByText("Uang Pangkal")).toBeInTheDocument();
    expect(screen.getByText("Nonaktif")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Tarif Uang Pangkal" })).not.toBeInTheDocument();
  });

  it("Tarif per Program: Simpan Tarif stays disabled until a tarif changes, then shows the unsaved-changes indicator", async () => {
    fixture();
    const user = userEvent.setup();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));
    const tarifInput = await screen.findByRole("textbox", { name: "Tarif SPP Bulanan" });

    const saveButton = screen.getByRole("button", { name: "Simpan Tarif" });
    expect(saveButton).toBeDisabled();
    expect(screen.queryByText("Ada perubahan belum disimpan")).not.toBeInTheDocument();

    await user.clear(tarifInput);
    await user.type(tarifInput, "600000");

    // Real keystrokes land in one mounted input: the value reaches the field
    // and the same DOM node still holds focus (the cell must not remount per
    // keystroke — STRUCTURE_COLUMNS is module-level for exactly this).
    expect(screen.getByRole("textbox", { name: "Tarif SPP Bulanan" })).toBe(tarifInput);
    expect(tarifInput).toHaveValue("600.000");
    expect(document.activeElement).toBe(tarifInput);
    expect(screen.getByText("Ada perubahan belum disimpan")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
  });

  it("Tarif per Program: switching Program while dirty asks to discard first — cancel keeps the pick, confirm applies it", async () => {
    fixture();
    const user = userEvent.setup();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Program" })).toHaveTextContent("Program Aktif"),
    );

    const tarifInput = screen.getByRole("textbox", { name: "Tarif SPP Bulanan" });
    await user.clear(tarifInput);
    await user.type(tarifInput, "600000");
    expect(screen.getByText("Ada perubahan belum disimpan")).toBeInTheDocument();

    // --- Cancel: the unsaved amount and the current Program selection both stay. ---
    await user.click(screen.getByRole("combobox", { name: "Program" }));
    await user.click(await screen.findByRole("option", { name: "Program Lama" }));

    const cancelDialog = await screen.findByRole("alertdialog");
    expect(within(cancelDialog).getByText("Buang perubahan tarif?")).toBeInTheDocument();
    expect(within(cancelDialog).getByText(/akan hilang/)).toBeInTheDocument();
    await user.click(within(cancelDialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    expect(screen.getByRole("combobox", { name: "Program" })).toHaveTextContent("Program Aktif");
    expect(screen.getByRole("textbox", { name: "Tarif SPP Bulanan" })).toHaveValue("600.000");

    // --- Confirm: the pending Program switch is applied. ---
    await user.click(screen.getByRole("combobox", { name: "Program" }));
    await user.click(await screen.findByRole("option", { name: "Program Lama" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: "Buang perubahan" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Program" })).toHaveTextContent("Program Lama");
    });
  });

  // react-hook-form + zod migration (cycle 2026-09-27-admin-forms-rhf, T5) —
  // the create/edit dialog now validates with createFeeComponentSchema
  // instead of an inline useState + toast.error check.
  it("Komponen Biaya: create dialog shows inline errors and sends no request on an empty submit", async () => {
    const fetchMock = fixture({ withStructure: false });
    const user = userEvent.setup();
    render(<FeesPage />);

    await screen.findByText("SPP Bulanan");
    await user.click(screen.getByRole("button", { name: "Tambah Komponen" }));

    const dialog = await screen.findByRole("dialog", { name: "Tambah Komponen Biaya" });
    const callsBeforeSubmit = fetchMock.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Tambah Komponen Biaya" }));

    expect(await within(dialog).findByText("Kode wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Label wajib diisi")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSubmit);
  });

  it("Komponen Biaya: a valid create submit POSTs the expected body", async () => {
    const fetchMock = fixture({ withStructure: false });
    const user = userEvent.setup();
    render(<FeesPage />);

    await screen.findByText("SPP Bulanan");
    await user.click(screen.getByRole("button", { name: "Tambah Komponen" }));

    const dialog = await screen.findByRole("dialog", { name: "Tambah Komponen Biaya" });
    await user.type(within(dialog).getByLabelText("Kode", { exact: false }), "uang_kegiatan");
    await user.type(within(dialog).getByLabelText("Label", { exact: false }), "Uang Kegiatan");
    await user.click(within(dialog).getByRole("button", { name: "Tambah Komponen Biaya" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url, init]) => url === "/api/fee-components" && (init as RequestInit)?.method === "POST"),
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/fee-components" && (init as RequestInit)?.method === "POST",
    )!;
    const [, init] = call as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      code: "uang_kegiatan",
      label: "Uang Kegiatan",
      category: "TUITION",
      isRecurring: true,
      sortOrder: 3,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Komponen biaya ditambahkan"));
  });
  // Cycle 2026-10-29-school-daycare-bundle-price (T4): the bundle section lives
  // under the program fee table, owns its fetch, and shares the discard gate
  // for the YEAR switch only.
  it("Tarif per Program: shows the Harga paket section for the selected year, below the fee table", async () => {
    const fetchMock = fixture();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));

    expect(await screen.findByRole("heading", { name: "Harga paket sekolah + daycare", level: 2 })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: BUNDLE_INPUT })).toHaveValue("");
    expect(screen.getByText("Rp 1.500.000")).toBeInTheDocument(); // 500.000 + 1.000.000
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/fee-bundles?academicYearId=year-active")).toBe(true),
    );
  });

  it("Tarif per Program: switching the YEAR with unsaved bundle edits asks to discard first — cancel keeps them, confirm drops them", async () => {
    fixture();
    const user = userEvent.setup();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));
    const bundleInput = await screen.findByRole("textbox", { name: BUNDLE_INPUT });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Tahun Ajaran" })).toHaveTextContent("2025/2026"));
    // The program tarif itself is untouched: only the bundle section is dirty.
    expect(screen.queryByText("Ada perubahan belum disimpan")).not.toBeInTheDocument();

    await user.type(bundleInput, "1400000");

    // --- Cancel: the year and the unsaved bundle price both stay. ---
    await user.click(screen.getByRole("combobox", { name: "Tahun Ajaran" }));
    await user.click(await screen.findByRole("option", { name: "2024/2025" }));
    const cancelDialog = await screen.findByRole("alertdialog");
    expect(within(cancelDialog).getByText("Buang perubahan tarif?")).toBeInTheDocument();
    expect(within(cancelDialog).getByText(/harga paket yang belum disimpan akan hilang/)).toBeInTheDocument();
    await user.click(within(cancelDialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Tahun Ajaran" })).toHaveTextContent("2025/2026");
    expect(screen.getByRole("textbox", { name: BUNDLE_INPUT })).toHaveValue("1.400.000");

    // --- Confirm: the year switches and the bundle edit is gone. ---
    await user.click(screen.getByRole("combobox", { name: "Tahun Ajaran" }));
    await user.click(await screen.findByRole("option", { name: "2024/2025" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: "Buang perubahan" }));

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Tahun Ajaran" })).toHaveTextContent("2024/2025"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: BUNDLE_INPUT })).toHaveValue(""));
    expect(screen.queryByText("Ada perubahan belum disimpan")).not.toBeInTheDocument();

    // And the gate is clear again: switching back needs no confirmation.
    await user.click(screen.getByRole("combobox", { name: "Tahun Ajaran" }));
    await user.click(await screen.findByRole("option", { name: "2025/2026" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Tahun Ajaran" })).toHaveTextContent("2025/2026"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Tarif per Program: switching the PROGRAM does not ask about, or touch, bundle edits", async () => {
    fixture();
    const user = userEvent.setup();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));
    await user.type(await screen.findByRole("textbox", { name: BUNDLE_INPUT }), "1400000");

    await user.click(screen.getByRole("combobox", { name: "Program" }));
    await user.click(await screen.findByRole("option", { name: "Program Lama" }));

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Program" })).toHaveTextContent("Program Lama"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: BUNDLE_INPUT })).toHaveValue("1.400.000");
  });

  it("Tarif per Program: a successful Simpan Tarif refreshes the bundle section's saved fees", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<FeesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: "Tarif per Program" }));
    await screen.findByRole("textbox", { name: BUNDLE_INPUT });
    const bundleReads = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/fee-bundles")).length;
    const before = bundleReads();

    const tarifInput = await screen.findByRole("textbox", { name: "Tarif SPP Bulanan" });
    await user.clear(tarifInput);
    await user.type(tarifInput, "600000");
    await user.click(screen.getByRole("button", { name: "Simpan Tarif" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Struktur biaya disimpan"));
    await waitFor(() => expect(bundleReads()).toBe(before + 1));
  });
});
