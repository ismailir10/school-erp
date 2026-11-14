/**
 * `KeringananTab` — react-hook-form + zod migration (cycle
 * 2026-09-27-admin-forms-rhf, T5). The create/edit dialog now validates with
 * `keringananFormSchema` (derived from `createStudentFeeAdjustmentSchema`)
 * instead of the old inline `fieldErrors` state + `validateForm()`.
 *
 * Covers: an empty create submit shows every required-field error inline and
 * sends no request; a PERCENT value over 100 is rejected inline (same cap as
 * the API schema); and editing a row whose `feeComponentId` is `null` (a
 * legacy/Cycle-B shape the edit dialog never renders as an input) still
 * submits — the create-only requiredness of studentId/academicYearId/
 * feeComponentId/type must not block an edit just because one of those
 * hidden fields looks "empty" (review finding).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { KeringananTab } from "../keringanan-tab";

const FEE_COMPONENT = { id: "fc-1", label: "SPP Bulanan", isEnabled: true, status: "ACTIVE" };
const YEAR = { id: "year-1", name: "2025/2026", status: "ACTIVE" };
const STUDENT = { name: "Ahmad Fauzi", nis: "12345" };

const ADJUSTMENT_NULL_COMPONENT = {
  id: "adj-1",
  studentId: "stu-1",
  academicYearId: YEAR.id,
  // Nullable on the model (Cycle B); Cycle A never wrote a row like this in
  // practice, but the schema allows it, and a stale/legacy row is exactly
  // the case the review finding was about — editing must not depend on it.
  feeComponentId: null,
  type: "DISCOUNT",
  mode: "PERCENT",
  value: "10",
  reason: "Alasan lama",
  validFrom: null,
  validTo: null,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  student: STUDENT,
  feeComponent: null,
  academicYear: { name: YEAR.name },
};

const ADJUSTMENT_WITH_VALIDITY = {
  ...ADJUSTMENT_NULL_COMPONENT,
  id: "adj-2",
  feeComponentId: "fc-1",
  feeComponent: { label: FEE_COMPONENT.label },
  validFrom: "2026-01-01",
  validTo: "2026-06-30",
};

// `KeringananTab` fetches fee-components + academic-years in a background
// effect regardless of dialog state (the create dialog's Selects need them),
// so that fetch's resolution + re-render can land while the row-actions
// dropdown is mid-open-transition — the same jsdom race
// `app/admin/fees/__tests__/page.test.tsx`'s `withStructure: false` sidesteps
// for its own unrelated fetch, confirmed here with `scripts/flake-hunt.sh`
// (the two "edit" tests below failed under CPU oversubscription without
// this). There's no fetch-skip knob on this component, so let both settle
// before touching the dropdown.
async function settleBackgroundFetches() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
}

function fixture({ adjustments = [] as unknown[] }: { adjustments?: unknown[] } = {}) {
  const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
    if (input.startsWith("/api/student-fee-adjustments/")) {
      return { ok: true, json: async () => ({}) };
    }
    if (input.startsWith("/api/student-fee-adjustments")) {
      return {
        ok: true,
        json: async () => ({
          data: adjustments,
          pagination: { page: 1, pageSize: 20, total: adjustments.length, totalPages: 1 },
        }),
      };
    }
    if (input.startsWith("/api/fee-components")) {
      return { ok: true, json: async () => [FEE_COMPONENT] };
    }
    if (input.startsWith("/api/academic-years")) {
      return { ok: true, json: async () => [YEAR] };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("KeringananTab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("create: an empty submit shows every required-field error inline and sends no request", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<KeringananTab canEdit />);

    await user.click(await screen.findByRole("button", { name: "Tambah Keringanan" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Keringanan" });

    const callsBeforeSubmit = fetchMock.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Tambah Keringanan" }));

    expect(await within(dialog).findByText("Siswa wajib dipilih")).toBeInTheDocument();
    expect(within(dialog).getByText("Tahun ajaran wajib dipilih")).toBeInTheDocument();
    expect(within(dialog).getByText("Komponen biaya wajib dipilih")).toBeInTheDocument();
    expect(within(dialog).getByText("Alasan wajib diisi")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSubmit);
  });

  it("create: a PERCENT value over 100 is rejected inline and sends no request", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<KeringananTab canEdit />);

    await user.click(await screen.findByRole("button", { name: "Tambah Keringanan" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Keringanan" });

    // Mode defaults to Persen (%), which renders the plain number input.
    await user.type(within(dialog).getByLabelText("Nilai", { exact: false }), "150");
    await user.type(within(dialog).getByLabelText("Alasan", { exact: false }), "Alasan uji");

    const callsBeforeSubmit = fetchMock.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Tambah Keringanan" }));

    expect(
      await within(dialog).findByText("Nilai persentase tidak boleh lebih dari 100"),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeSubmit);
  });

  it("edit: a row with feeComponentId null still submits Simpan Perubahan as a PUT", async () => {
    const fetchMock = fixture({ adjustments: [ADJUSTMENT_NULL_COMPONENT] });
    const user = userEvent.setup();
    render(<KeringananTab canEdit />);

    await screen.findByText(STUDENT.name);
    await settleBackgroundFetches();
    await user.click(screen.getByRole("button", { name: `Aksi untuk ${STUDENT.name}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Keringanan" });
    expect(within(dialog).getByLabelText("Nilai", { exact: false })).toHaveValue(10);

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === "/api/student-fee-adjustments/adj-1" && (init as RequestInit)?.method === "PUT",
        ),
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/student-fee-adjustments/adj-1" && (init as RequestInit)?.method === "PUT",
    )!;
    const [, init] = call;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ mode: "PERCENT", value: 10, reason: "Alasan lama", validFrom: null, validTo: null });
  });

  it("edit: clearing Berlaku Sampai sends validTo: null while validFrom is unchanged (matches HEAD's `|| null`)", async () => {
    // Fine-pointer (default in jsdom) Calendar popover, not the native
    // `<input type="date">` — forcing coarse pointer globally here would
    // also change how the row-actions dropdown menu above opens, which is
    // unrelated to what this test is about.
    const fetchMock = fixture({ adjustments: [ADJUSTMENT_WITH_VALIDITY] });
    const user = userEvent.setup();
    render(<KeringananTab canEdit />);

    await screen.findByText(STUDENT.name);
    await settleBackgroundFetches();
    await user.click(screen.getByRole("button", { name: `Aksi untuk ${STUDENT.name}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Keringanan" });
    const validToTrigger = within(dialog).getByLabelText("Berlaku Sampai", { exact: false });
    await user.click(validToTrigger);
    // The Calendar popover portals to document.body, outside `dialog`'s
    // subtree — same reason the fee-component Select options are queried
    // via `screen`/`page` elsewhere in this suite family, not `within(dialog)`.
    await user.click(await screen.findByRole("button", { name: "Hapus tanggal" }));

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => url === "/api/student-fee-adjustments/adj-2" && (init as RequestInit)?.method === "PUT",
        ),
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/student-fee-adjustments/adj-2" && (init as RequestInit)?.method === "PUT",
    )!;
    const [, init] = call;
    const body = JSON.parse((init as RequestInit).body as string);
    // HEAD sent `validFrom: form.validFrom || null` / `validTo: form.validTo || null`
    // unconditionally — an untouched validFrom must still be resent as its
    // real value (not omitted), and a cleared validTo must be the literal
    // `null` the PUT route reads as "clear", not a dropped key.
    expect(body).toEqual({
      mode: "PERCENT",
      value: 10,
      reason: "Alasan lama",
      validFrom: "2026-01-01",
      validTo: null,
    });
  });
});
