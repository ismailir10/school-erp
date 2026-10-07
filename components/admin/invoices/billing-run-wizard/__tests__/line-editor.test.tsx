/**
 * T6 — the line-editor "Hapus baris tagihan" confirm was a raw AlertDialog;
 * it now goes through the shared ConfirmDialog (ui.md Overlays Rule). These
 * tests drive `EditableRowLines`'s delete-line flow end to end against a
 * stubbed fetch to prove open/confirm/cancel still behave, including the
 * confirm-stays-open-on-error case ConfirmDialog's own catch swallows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EditableRowLines } from "../line-editor";
import type { BillingRunRowData } from "../types";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function row(): BillingRunRowData {
  return {
    id: "row-1",
    billingRunId: "run-1",
    studentId: "stu-1",
    studentNameSnapshot: "Bilal Ahmad",
    classLabelSnapshot: "KB 1",
    parentId: "parent-1",
    totalDue: 500_000,
    status: "PENDING",
    invoiceId: null,
    error: null,
    lines: [
      {
        id: "line-1",
        feeComponentId: "fee-1",
        labelSnapshot: "SPP September",
        amount: 500_000,
        adjustmentAmount: 0,
        adjustmentNote: null,
        finalAmount: 500_000,
        source: "CATALOG",
      },
    ],
  };
}

function renderLines(onLineRemoved = vi.fn(), rowData: BillingRunRowData = row()) {
  render(
    <EditableRowLines
      runId="run-1"
      row={rowData}
      feeComponents={[]}
      onLineUpdated={vi.fn()}
      onLineAdded={vi.fn()}
      onLineRemoved={onLineRemoved}
    />,
  );
  return { onLineRemoved };
}

describe("EditableRowLines — delete-line ConfirmDialog (T6)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the confirm with the line's label and cancels without deleting", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { onLineRemoved } = renderLines();

    await user.click(screen.getByRole("button", { name: "Hapus baris SPP September" }));

    expect(await screen.findByText("Hapus baris tagihan ini?")).toBeInTheDocument();
    expect(
      screen.getByText(/"SPP September" akan dihapus dari tagihan Bilal Ahmad/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Batal" }));

    await waitFor(() => {
      expect(screen.queryByText("Hapus baris tagihan ini?")).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onLineRemoved).not.toHaveBeenCalled();
  });

  it("confirms and removes the line on success", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ totalDue: 0 }),
      }),
    );
    const { onLineRemoved } = renderLines();

    await user.click(screen.getByRole("button", { name: "Hapus baris SPP September" }));
    await screen.findByText("Hapus baris tagihan ini?");

    await user.click(screen.getByRole("button", { name: "Ya, Hapus" }));

    await waitFor(() => expect(onLineRemoved).toHaveBeenCalledWith("line-1", 0));
    await waitFor(() => {
      expect(screen.queryByText("Hapus baris tagihan ini?")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog open and toasts an error when the delete fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Baris terakhir tidak bisa dihapus" }),
      }),
    );
    const { onLineRemoved } = renderLines();

    await user.click(screen.getByRole("button", { name: "Hapus baris SPP September" }));
    await screen.findByText("Hapus baris tagihan ini?");

    await user.click(screen.getByRole("button", { name: "Ya, Hapus" }));

    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Baris terakhir tidak bisa dihapus"),
    );
    expect(screen.getByText("Hapus baris tagihan ini?")).toBeInTheDocument();
    expect(onLineRemoved).not.toHaveBeenCalled();
  });
});

describe("EditableRowLines — edit-line amount (FINX-1)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function patchedBody(fetchMock: ReturnType<typeof vi.fn>) {
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(call).toBeDefined();
    return JSON.parse(call![1].body as string);
  }

  function stubPatchOk() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ line: row().lines[0], totalDue: 1_500_000 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("accepts a grouped id-ID amount and PATCHes the whole number", async () => {
    const user = userEvent.setup();
    const fetchMock = stubPatchOk();
    renderLines();

    await user.click(screen.getByRole("button", { name: "Edit baris SPP September" }));
    const amount = await screen.findByRole("textbox", { name: /Jumlah Akhir/ });
    expect(amount).toHaveValue("500.000");

    await user.clear(amount);
    await user.type(amount, "1.500.000");
    expect(amount).toHaveValue("1.500.000");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchedBody(fetchMock).finalAmount).toBe(1_500_000);
  });

  it("reads 1500000,50 as 1.500.000, never 150.000.050", async () => {
    const user = userEvent.setup();
    const fetchMock = stubPatchOk();
    renderLines();

    await user.click(screen.getByRole("button", { name: "Edit baris SPP September" }));
    const amount = await screen.findByRole("textbox", { name: /Jumlah Akhir/ });
    await user.clear(amount);
    await user.type(amount, "1500000,50");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchedBody(fetchMock).finalAmount).toBe(1_500_000);
  });

  it("allows zeroing a line", async () => {
    const user = userEvent.setup();
    const fetchMock = stubPatchOk();
    renderLines();

    await user.click(screen.getByRole("button", { name: "Edit baris SPP September" }));
    const amount = await screen.findByRole("textbox", { name: /Jumlah Akhir/ });
    await user.clear(amount);
    await user.type(amount, "0");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchedBody(fetchMock).finalAmount).toBe(0);
  });

  it("keeps the 'bilangan bulat' message when the amount is cleared", async () => {
    const user = userEvent.setup();
    const fetchMock = stubPatchOk();
    renderLines();

    await user.click(screen.getByRole("button", { name: "Edit baris SPP September" }));
    const amount = await screen.findByRole("textbox", { name: /Jumlah Akhir/ });
    await user.clear(amount);
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Jumlah harus berupa bilangan bulat")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a typed minus on a non-MANUAL line (fee components stay non-negative)", async () => {
    const user = userEvent.setup();
    const fetchMock = stubPatchOk();
    renderLines();

    await user.click(screen.getByRole("button", { name: "Edit baris SPP September" }));
    const amount = await screen.findByRole("textbox", { name: /Jumlah Akhir/ });
    await user.clear(amount);
    await user.type(amount, "-250000");
    expect(amount).toHaveValue("250.000");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchedBody(fetchMock).finalAmount).toBe(250_000);
  });

  it("shows a MANUAL discount line's negative amount with its sign and keeps it negative", async () => {
    const user = userEvent.setup();
    const fetchMock = stubPatchOk();
    const manual = row();
    manual.lines = [
      {
        ...manual.lines[0]!,
        id: "line-2",
        labelSnapshot: "Potongan promo",
        amount: 0,
        adjustmentAmount: -100_000,
        finalAmount: -100_000,
        source: "MANUAL",
      },
    ];
    renderLines(vi.fn(), manual);

    await user.click(screen.getByRole("button", { name: "Edit baris Potongan promo" }));
    const amount = await screen.findByRole("textbox", { name: /Jumlah Akhir/ });
    expect(amount).toHaveValue("-100.000");

    await user.clear(amount);
    await user.type(amount, "-1.250.000");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(patchedBody(fetchMock).finalAmount).toBe(-1_250_000);
  });
});
