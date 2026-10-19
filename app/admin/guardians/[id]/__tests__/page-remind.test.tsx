/**
 * "Ingatkan via WhatsApp" on the wali page: one wa.me message to this wali
 * listing every unpaid invoice, opened synchronously in the click, followed by
 * a stamp per invoice through the existing per-invoice reminder endpoint.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import GuardianDetailPage from "../page";
import { CLEAN_SUMMARY, fulfilledParams, makeParent, okJson } from "./parent-fixture";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const TWO_UNPAID = [
  { id: "inv-1", invoiceNumber: "INV-2026-0001", periodLabel: "Januari 2026", studentName: "Ahmad Fajar", remaining: 400_000 },
  { id: "inv-2", invoiceNumber: "INV-2026-0002", periodLabel: "Februari 2026", studentName: "Ahmad Fajar", remaining: 500_000 },
];

const REMIND = "Ingatkan via WhatsApp";

type Reply = (url: string) => Promise<Response>;

async function renderWith(parent: Record<string, unknown>, onStamp?: Reply) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/reminder")) {
      return onStamp ? onStamp(url) : okJson({ waUrl: "https://wa.me/ignored" });
    }
    return okJson(parent);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  await screen.findByRole("heading", { level: 1 });
  return { user, fetchMock };
}

const stamps = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith("/reminder") && (init as RequestInit)?.method === "POST");

let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  openSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("guardian page — Ingatkan via WhatsApp visibility", () => {
  it("shows on the owed row for a viewer with payments.record when the wali has a number", async () => {
    await renderWith(makeParent());
    const strip = screen.getByRole("region", { name: "Perlu perhatian" });
    expect(within(strip).getByRole("button", { name: REMIND })).toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: "Lihat tagihan" })).toBeInTheDocument();
  });

  it("is absent without canRemind", async () => {
    await renderWith(makeParent({ canRemind: false }));
    expect(screen.queryByRole("button", { name: REMIND })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lihat tagihan" })).toBeInTheDocument();
  });

  it("is absent when the wali has no number WhatsApp can open", async () => {
    await renderWith(makeParent({ phone: null, whatsapp: "-" }));
    expect(screen.queryByRole("button", { name: REMIND })).not.toBeInTheDocument();
  });

  it("is absent when nothing is owed", async () => {
    await renderWith(
      makeParent({ unpaidInvoices: [], invoices: [], invoiceSummary: CLEAN_SUMMARY, hasKk: true }),
    );
    expect(screen.queryByRole("button", { name: REMIND })).not.toBeInTheDocument();
  });
});

describe("guardian page — Ingatkan via WhatsApp click", () => {
  it("opens wa.me to this wali with every unpaid invoice before any stamp is requested", async () => {
    // Stamps hang until released: if the chat only opened after them, the spy would still be empty.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { user, fetchMock } = await renderWith(makeParent({ unpaidInvoices: TWO_UNPAID, invoiceSummary: { ...makeParent().invoiceSummary, outstanding: 900_000, unpaidCount: 2 } }), async () => {
      await gate;
      return okJson({});
    });

    await user.click(screen.getByRole("button", { name: REMIND }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0] as [string, string, string];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toContain("Bapak/Ibu Ibu Siti Aminah");
    expect(text).toContain("INV-2026-0001");
    expect(text).toContain("INV-2026-0002");
    expect(text).toContain("Total: Rp 900.000");
    expect(text).toContain(`${window.location.origin}/parent/invoices`);
    expect(stamps(fetchMock)).toHaveLength(2);

    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("states the whole debt and names the invoices beyond the listed ones", async () => {
    const { user } = await renderWith(
      makeParent({
        unpaidInvoices: TWO_UNPAID,
        invoiceSummary: { ...makeParent().invoiceSummary, outstanding: 5_000_000, unpaidCount: 27 },
      }),
    );
    await user.click(screen.getByRole("button", { name: REMIND }));
    const text = decodeURIComponent((openSpy.mock.calls[0][0] as string).split("?text=")[1]);
    expect(text).toContain("Total: Rp 5.000.000");
    expect(text).toContain("- dan 25 tagihan lainnya");
  });

  it("stamps each unpaid invoice and reports how many were recorded", async () => {
    const { user, fetchMock } = await renderWith(makeParent({ unpaidInvoices: TWO_UNPAID }));

    await user.click(screen.getByRole("button", { name: REMIND }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pengingat dicatat untuk 2 dari 2 tagihan"));
    expect(stamps(fetchMock).map(([u]) => String(u)).sort()).toEqual([
      "/api/invoices/inv-1/reminder",
      "/api/invoices/inv-2/reminder",
    ]);
  });

  it("counts only the stamps that succeeded; a refused one does not undo the chat", async () => {
    const { user } = await renderWith(makeParent({ unpaidInvoices: TWO_UNPAID }), (url) =>
      url.includes("inv-2") ? okJson({ error: "x" }, 409) : okJson({}),
    );

    await user.click(screen.getByRole("button", { name: REMIND }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pengingat dicatat untuk 1 dari 2 tagihan"));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when no stamp could be recorded, and still leaves the chat open", async () => {
    const { user } = await renderWith(makeParent(), () => Promise.reject(new Error("offline")));

    await user.click(screen.getByRole("button", { name: REMIND }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Pengingat belum tercatat, tetapi WhatsApp sudah dibuka."),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
