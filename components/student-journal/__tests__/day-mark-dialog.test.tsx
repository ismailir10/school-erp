import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

import { DayMarkDialog } from "../day-mark-dialog";

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body });

function setup(initialReason: string | null = null) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DayMarkDialog open onOpenChange={onOpenChange} classSectionId="c1" date="2026-10-27" initialReason={initialReason} onSaved={onSaved} />,
  );
  return { onSaved, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => reply(200, { data: {} })));
});

describe("DayMarkDialog", () => {
  it("fills the keterangan from a suggestion chip and saves it trimmed", async () => {
    const { onSaved, onOpenChange } = setup();
    const save = screen.getByTestId("day-mark-save");
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Renang" }));
    expect(screen.getByLabelText("Keterangan")).toHaveValue("Renang");
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Renang"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/student-journal/day-marks");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ classSectionId: "c1", date: "2026-10-27", reason: "Renang" });
  });

  it("accepts typed free text and saves on Enter", async () => {
    const { onSaved } = setup();
    const input = screen.getByLabelText("Keterangan");
    fireEvent.change(input, { target: { value: "  Kunjungan kebun  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Kunjungan kebun"));
  });

  it("caps the keterangan at 60 characters and shows the count", () => {
    setup();
    expect(screen.getByLabelText("Keterangan")).toHaveAttribute("maxlength", "60");
    fireEvent.change(screen.getByLabelText("Keterangan"), { target: { value: "Renang" } });
    expect(screen.getByText("6/60")).toBeInTheDocument();
  });

  it("offers Hapus tanda only for an existing mark, and removes it with DELETE", async () => {
    const { onSaved } = setup("Libur");
    expect(screen.getByLabelText("Keterangan")).toHaveValue("Libur");
    expect(screen.getByTestId("day-mark-save")).toBeDisabled(); // unchanged
    fireEvent.click(screen.getByTestId("day-mark-remove"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null));
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ classSectionId: "c1", date: "2026-10-27" });
  });

  it("has no Hapus tanda for a day that is not marked yet", () => {
    setup();
    expect(screen.queryByTestId("day-mark-remove")).toBeNull();
  });

  it("keeps the dialog open and shows the server's reason when saving fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(403, { error: "Forbidden" })));
    const { onSaved, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Libur" }));
    fireEvent.click(screen.getByTestId("day-mark-save"));
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Forbidden");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("says to slow down on a 429 and survives a dropped connection", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(429)));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Libur" }));
    fireEvent.click(screen.getByTestId("day-mark-save"));
    expect(await screen.findByText("Terlalu banyak permintaan. Coba lagi sebentar.")).toBeInTheDocument();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    fireEvent.click(screen.getByTestId("day-mark-save"));
    expect(await screen.findByText("Koneksi terputus. Coba lagi sebentar ya.")).toBeInTheDocument();
  });
});
