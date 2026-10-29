import { MESSAGES } from "@/lib/feedback";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { NoteDeleteDialog } from "@/components/student-journal/note-delete-dialog";

beforeEach(() => {
  vi.unstubAllGlobals();
  toast.error.mockClear();
  toast.success.mockClear();
});

describe("NoteDeleteDialog", () => {
  it("stays closed without a note", () => {
    render(<NoteDeleteDialog noteId={null} onClose={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByText("Hapus catatan ini?")).toBeNull();
  });

  it("deletes the note once confirmed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    render(<NoteDeleteDialog noteId="n1" onClose={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/student-journal/notes/n1", { method: "DELETE" });
    expect(toast.success).toHaveBeenCalledWith("Catatan dihapus");
  });

  it("reports a refusal, keeps the note and does not claim success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Forbidden" }) }));
    const onDeleted = vi.fn();
    render(<NoteDeleteDialog noteId="n1" onClose={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Forbidden"));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says the connection dropped instead of leaking the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<NoteDeleteDialog noteId="n1" onClose={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(MESSAGES.network));
  });
});
