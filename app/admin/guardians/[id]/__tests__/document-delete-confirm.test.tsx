/**
 * Guardian KTP/KK "Hapus" is destructive, so it goes through <ConfirmDialog>
 * (ui.md) instead of deleting on click.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import GuardianDetailPage from "../page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function fulfilledParams(value: { id: string }): Promise<{ id: string }> {
  const p = Promise.resolve(value) as Promise<{ id: string }> & { status?: string; value?: { id: string } };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

const PARENT = {
  id: "p1",
  canEdit: true,
  name: "Ibu Siti Aminah",
  email: "siti@example.test",
  phone: "081234567890",
  whatsapp: "081234567890",
  address: "Jl. Melati No. 1",
  nik: "3201010101010001",
  education: "S1",
  occupation: "Guru",
  employer: "SDN 1",
  employerAddress: null,
  employerCity: "Bandung",
  incomeRange: "5-10 juta",
  childrenTotal: 0,
  hasKtp: true,
  hasKk: true,
  status: "ACTIVE",
  guardians: [],
  invoices: [],
};

const deleteCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");

async function renderPage() {
  const user = userEvent.setup();
  render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  await screen.findByRole("heading", { name: "Ibu Siti Aminah" });
  return user;
}

describe("guardian page — KTP/KK delete confirmation", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          json: async () => (init?.method === "DELETE" ? { success: true } : PARENT),
        } as Response),
      ),
    );
  });

  it("Hapus asks first and sends no DELETE until 'Ya, Hapus'", async () => {
    const user = await renderPage();

    await user.click(screen.getAllByRole("button", { name: "Hapus" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Hapus KTP?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("KTP Ibu Siti Aminah akan dihapus. Unggah lagi jika masih diperlukan."),
    ).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Ya, Hapus" }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(String(deleteCalls()[0][0])).toBe("/api/parents/p1/ktp");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("KTP dihapus"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("a failed delete shows the error toast and closes the dialog", async () => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(fetch).mockImplementation((_input, init) =>
      Promise.resolve({
        ok: init?.method !== "DELETE",
        json: async () => (init?.method === "DELETE" ? { error: "x" } : PARENT),
      } as Response),
    );
    const user = await renderPage();

    await user.click(screen.getAllByRole("button", { name: "Hapus" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Ya, Hapus" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gagal menghapus KTP"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("Batal closes the dialog and deletes nothing", async () => {
    const user = await renderPage();

    await user.click(screen.getAllByRole("button", { name: "Hapus" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleteCalls()).toHaveLength(0);
  });

  it("the KK row confirms with its own title and deletes the KK", async () => {
    const user = await renderPage();

    await user.click(screen.getAllByRole("button", { name: "Hapus" })[1]);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Hapus KK?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Ya, Hapus" }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(String(deleteCalls()[0][0])).toBe("/api/parents/p1/kk");
  });
});
