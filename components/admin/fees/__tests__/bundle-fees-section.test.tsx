/**
 * "Harga paket sekolah + daycare" section of Tarif per Program — cycle
 * docs/cycles/2026-10-29-school-daycare-bundle-price.md (T4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { BundleFeesSection } from "../bundle-fees-section";

const SAVED = "Harga paket disimpan. Draf tagihan yang sudah dibuat perlu dihitung ulang.";

type Data = ReturnType<typeof makeData>;

function makeData(over: Record<string, unknown> = {}) {
  return {
    canEdit: true,
    programs: [
      { id: "p-a", code: "TKIT-A", name: "TKIT-A", type: "SEMESTER", status: "ACTIVE" },
      { id: "p-b", code: "TKIT-B", name: "TKIT-B", type: "SEMESTER", status: "ACTIVE" },
      { id: "p-old", code: "KB", name: "KB Lama", type: "SEMESTER", status: "INACTIVE" },
      { id: "p-day", code: "DCARE", name: "D'Care", type: "YEAR_ROUND", status: "ACTIVE" },
      { id: "p-pop", code: "POPUP", name: "Pop-up", type: "SESSION", status: "ACTIVE" },
    ],
    components: [
      { id: "fc-spp", code: "spp", label: "SPP Bulanan" },
      { id: "fc-meal", code: "meal", label: "Makan" },
      { id: "fc-act", code: "act", label: "Kegiatan" },
    ],
    programFees: [
      { programId: "p-a", feeComponentId: "fc-spp", amount: 499000 },
      { programId: "p-b", feeComponentId: "fc-spp", amount: 504000 },
      { programId: "p-day", feeComponentId: "fc-spp", amount: 1061000 },
      // Makan: only the school program prices it, so it is not shared.
      { programId: "p-a", feeComponentId: "fc-meal", amount: 100000 },
      // Kegiatan: both carry a row but the sum is 0.
      { programId: "p-b", feeComponentId: "fc-act", amount: 0 },
      { programId: "p-day", feeComponentId: "fc-act", amount: 0 },
      { programId: "p-old", feeComponentId: "fc-spp", amount: 400000 },
    ],
    bundles: [
      {
        id: "bf-1",
        schoolProgramId: "p-a",
        daycareProgramId: "p-day",
        feeComponentId: "fc-spp",
        amount: 1560000,
        status: "ACTIVE",
      },
    ],
    ...over,
  };
}

type PutReply = { ok: boolean; status: number; body: unknown };

/** GET answers `data` (a function so a test can change it between calls); PUT answers `put`. */
function stubFetch(getData: () => Data | { status: number }, put: PutReply = { ok: true, status: 200, body: { ok: true, changed: 1 } }) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === "PUT") return { ok: put.ok, status: put.status, json: async () => put.body };
    const data = getData();
    if ("status" in data && !("canEdit" in data)) return { ok: false, status: data.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => data };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const puts = (f: ReturnType<typeof stubFetch>) =>
  f.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
const gets = (f: ReturnType<typeof stubFetch>) =>
  f.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== "PUT");
const putBody = (f: ReturnType<typeof stubFetch>) => JSON.parse(puts(f)[0]![1]!.body as string);

const inputName = (component: string, school: string) =>
  `Harga paket ${component}, ${school} + D'Care`;

function setup(props: Partial<Parameters<typeof BundleFeesSection>[0]> = {}) {
  const onDirtyChange = vi.fn();
  const utils = render(
    <BundleFeesSection academicYearId="ay-1" refreshKey={0} onDirtyChange={onDirtyChange} {...props} />,
  );
  return { onDirtyChange, ...utils };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("BundleFeesSection", () => {
  it("asks for the chosen year and shows the title and the one-line explanation", async () => {
    const f = stubFetch(() => makeData());
    setup({ academicYearId: "ay-9" });

    expect(await screen.findByRole("heading", { name: "Harga paket sekolah + daycare", level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText(/Isi kalau anak yang ikut sekolah dan daycare ditagih satu harga paket/),
    ).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith("/api/fee-bundles?academicYearId=ay-9");
  });

  it("renders one block per daycare program with rows only for components both programs price", async () => {
    stubFetch(() => makeData());
    setup();

    expect(await screen.findByRole("heading", { name: "Daycare: D'Care", level: 3 })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Harga paket untuk D'Care" });
    const rows = within(table).getAllByRole("row");
    // header + TKIT-A SPP + TKIT-B SPP
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("TKIT-A")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("SPP Bulanan")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("TKIT-B")).toBeInTheDocument();
    for (const header of ["Program sekolah", "Komponen", "Jumlah biasa", "Harga paket"]) {
      expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    // Not shared (only school prices it), zero-sum, an inactive school program and a SESSION program.
    expect(screen.queryByText("Makan")).not.toBeInTheDocument();
    expect(screen.queryByText("Kegiatan")).not.toBeInTheDocument();
    expect(screen.queryByText("KB Lama")).not.toBeInTheDocument();
    expect(screen.queryByText("Pop-up")).not.toBeInTheDocument();
  });

  it("shows the saved school + daycare sum as 'Jumlah biasa' and the saved price in the input", async () => {
    stubFetch(() => makeData());
    setup();

    const rowA = (await screen.findByText("TKIT-A")).closest("tr")!;
    const rowB = screen.getByText("TKIT-B").closest("tr")!;
    expect(within(rowA).getByText("Rp 1.560.000")).toBeInTheDocument(); // 499.000 + 1.061.000
    expect(within(rowB).getByText("Rp 1.565.000")).toBeInTheDocument(); // 504.000 + 1.061.000
    expect(screen.getByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-A") })).toHaveValue("1.560.000");
    const empty = screen.getByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") });
    expect(empty).toHaveValue("");
    expect(empty).toHaveAttribute("placeholder", "Belum diisi");
  });

  it("shows a cleared (INACTIVE) price as an empty input, and keeps its row even without shared fees", async () => {
    stubFetch(() =>
      makeData({
        programFees: [],
        bundles: [
          {
            id: "bf-9",
            schoolProgramId: "p-a",
            daycareProgramId: "p-day",
            feeComponentId: "fc-spp",
            amount: 1560000,
            status: "INACTIVE",
          },
        ],
      }),
    );
    setup();

    const input = await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-A") });
    expect(input).toHaveValue("");
  });

  it("reports dirty on an edit and clean again when the edit is put back", async () => {
    stubFetch(() => makeData());
    const user = userEvent.setup();
    const { onDirtyChange } = setup();

    const input = await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    const save = screen.getByRole("button", { name: "Simpan harga paket" });
    expect(save).toBeDisabled();
    expect(screen.queryByText("Ada perubahan belum disimpan")).not.toBeInTheDocument();

    await user.type(input, "1500000");

    // One mounted input keeps focus across keystrokes (no remount per keystroke).
    expect(screen.getByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") })).toBe(input);
    expect(input).toHaveValue("1.500.000");
    expect(document.activeElement).toBe(input);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByText("Ada perubahan belum disimpan")).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.clear(input);
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(save).toBeDisabled();
  });

  it("saves only the changed cells, toasts the reminder, refetches and goes clean", async () => {
    const f = stubFetch(() => makeData());
    const user = userEvent.setup();
    const { onDirtyChange } = setup();

    await user.type(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") }), "1500000");
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(puts(f)[0]![0]).toBe("/api/fee-bundles");
    expect(putBody(f)).toEqual({
      academicYearId: "ay-1",
      changes: [{ schoolProgramId: "p-b", daycareProgramId: "p-day", feeComponentId: "fc-spp", amount: 1_500_000 }],
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SAVED));
    // Initial read + the refetch after the save.
    await waitFor(() => expect(gets(f)).toHaveLength(2));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole("button", { name: "Simpan harga paket" })).toBeDisabled();
  });

  it("clearing a saved price sends amount null", async () => {
    const f = stubFetch(() => makeData());
    const user = userEvent.setup();
    setup();

    await user.clear(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-A") }));
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(putBody(f).changes).toEqual([
      { schoolProgramId: "p-a", daycareProgramId: "p-day", feeComponentId: "fc-spp", amount: null },
    ]);
  });

  it("typing a price over a cleared (INACTIVE) one sends the number", async () => {
    const f = stubFetch(() =>
      makeData({
        bundles: [
          {
            id: "bf-1",
            schoolProgramId: "p-a",
            daycareProgramId: "p-day",
            feeComponentId: "fc-spp",
            amount: 1560000,
            status: "INACTIVE",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    setup();

    await user.type(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-A") }), "1560000");
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(putBody(f).changes).toEqual([
      { schoolProgramId: "p-a", daycareProgramId: "p-day", feeComponentId: "fc-spp", amount: 1_560_000 },
    ]);
  });

  it("sends several changes together in one request", async () => {
    const f = stubFetch(() => makeData());
    const user = userEvent.setup();
    setup();

    await user.clear(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-A") }));
    await user.type(screen.getByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") }), "1500000");
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(putBody(f).changes).toEqual([
      { schoolProgramId: "p-a", daycareProgramId: "p-day", feeComponentId: "fc-spp", amount: null },
      { schoolProgramId: "p-b", daycareProgramId: "p-day", feeComponentId: "fc-spp", amount: 1_500_000 },
    ]);
  });

  it("refuses an amount of 0 on the spot, with no request", async () => {
    const f = stubFetch(() => makeData());
    const user = userEvent.setup();
    setup();

    await user.type(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") }), "0");
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Harga paket harus lebih dari 0");
    expect(puts(f)).toHaveLength(0);
  });

  it("shows the server's field message on a validation failure and keeps the edit", async () => {
    stubFetch(
      () => makeData(),
      {
        ok: false,
        status: 400,
        body: { error: "Validasi gagal", errors: [{ field: "changes.0.amount", message: "Harga paket harus lebih dari 0" }] },
      },
    );
    const user = userEvent.setup();
    const { onDirtyChange } = setup();

    const input = await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") });
    await user.type(input, "1500000");
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Harga paket harus lebih dari 0");
    expect(toast.success).not.toHaveBeenCalled();
    expect(input).toHaveValue("1.500.000");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "Simpan harga paket" })).toBeEnabled();
  });

  it("shows the server's own error text on a business-rule failure", async () => {
    stubFetch(
      () => makeData(),
      { ok: false, status: 400, body: { error: "TKIT-B belum punya tarif SPP Bulanan di tahun ajaran ini." } },
    );
    const user = userEvent.setup();
    setup();

    await user.type(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") }), "1500000");
    await user.click(screen.getByRole("button", { name: "Simpan harga paket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("TKIT-B belum punya tarif SPP Bulanan di tahun ajaran ini.");
  });

  it("is read-only without edit rights: disabled inputs, no save button, a short note", async () => {
    stubFetch(() => makeData({ canEdit: false }));
    setup();

    const input = await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-A") });
    expect(input).toBeDisabled();
    expect(input).toHaveValue("1.560.000");
    expect(screen.queryByRole("button", { name: "Simpan harga paket" })).not.toBeInTheDocument();
    expect(screen.getByText(/Anda hanya bisa melihat harga paket/)).toBeInTheDocument();
  });

  it.each([
    ["no daycare program", { programs: makeData().programs.filter((p) => p.type !== "YEAR_ROUND") }],
    ["no school program", { programs: makeData().programs.filter((p) => p.type !== "SEMESTER") }],
    ["no shared component", { programFees: [{ programId: "p-a", feeComponentId: "fc-spp", amount: 499000 }], bundles: [] }],
  ])("shows the empty-state sentence when there is %s", async (_label, over) => {
    stubFetch(() => makeData(over));
    setup();

    expect(await screen.findByText(/Harga paket butuh satu program sekolah dan satu program daycare/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Simpan harga paket" })).not.toBeInTheDocument();
  });

  it("shows a retry when the read fails, and loads on retry", async () => {
    let fail = true;
    const f = stubFetch(() => (fail ? { status: 500 } : makeData()));
    const user = userEvent.setup();
    setup();

    expect(await screen.findByText("Harga paket tidak bisa dimuat sekarang.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(gets(f)).toHaveLength(2);
  });

  it("says so when the role may not read fee bundles", async () => {
    stubFetch(() => ({ status: 403 }));
    setup();
    expect(await screen.findByText(/hanya terlihat oleh peran dengan akses biaya/)).toBeInTheDocument();
  });

  it("refetches on refreshKey, updating the 'Jumlah biasa' hint without wiping an unsaved edit", async () => {
    let data = makeData();
    const f = stubFetch(() => data);
    const user = userEvent.setup();
    const { rerender, onDirtyChange } = setup();

    const input = await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") });
    await user.type(input, "1500000");
    expect(screen.getByText("Rp 1.565.000")).toBeInTheDocument();

    data = makeData({
      programFees: makeData().programFees.map((fee) =>
        fee.programId === "p-b" && fee.feeComponentId === "fc-spp" ? { ...fee, amount: 600000 } : fee,
      ),
    });
    rerender(<BundleFeesSection academicYearId="ay-1" refreshKey={1} onDirtyChange={onDirtyChange} />);

    expect(await screen.findByText("Rp 1.661.000")).toBeInTheDocument(); // 600.000 + 1.061.000
    expect(gets(f)).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") })).toHaveValue("1.500.000");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("switching year loads that year and drops the unsaved edits", async () => {
    const f = stubFetch(() => makeData());
    const user = userEvent.setup();
    const { rerender, onDirtyChange } = setup();

    await user.type(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") }), "1500000");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    rerender(<BundleFeesSection academicYearId="ay-2" refreshKey={0} onDirtyChange={onDirtyChange} />);

    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/fee-bundles?academicYearId=ay-2"));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") })).toHaveValue("");
  });

  it("reports clean when it unmounts, so the page's gate cannot get stuck", async () => {
    stubFetch(() => makeData());
    const user = userEvent.setup();
    const { unmount, onDirtyChange } = setup();

    await user.type(await screen.findByRole("textbox", { name: inputName("SPP Bulanan", "TKIT-B") }), "1500000");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
