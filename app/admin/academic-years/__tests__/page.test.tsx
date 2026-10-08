/**
 * R2-ADMIN-15 — "Tambah Tahun Ajaran" continues the latest open year (name
 * placeholder, Mulai/Selesai defaults), the overlap rejection reads as itself
 * in the toast, and the roll-forward row action says where it copies from.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { toast } from "sonner";
import AcademicPage from "../page";

const years = [
  { id: "y2", name: "2027/2028", startDate: "2027-07-12", endDate: "2028-07-09", status: "PLANNING" },
  { id: "y1", name: "2026/2027", startDate: "2026-07-13", endDate: "2027-07-09", status: "ACTIVE" },
  { id: "y0", name: "2025/2026", startDate: "2025-07-14", endDate: "2026-07-10", status: "ARCHIVED" },
];

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function stub(postResult?: { status: number; body: unknown }) {
  const f = vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/academic-years" && init?.method === "POST") {
      return Promise.resolve(json(postResult?.body ?? { id: "new" }, postResult?.status ?? 201));
    }
    if (input === "/api/academic-years") return Promise.resolve(json(years));
    if (input === "/api/programs") return Promise.resolve(json([]));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", f);
  return f;
}

async function openAdd() {
  const user = userEvent.setup();
  render(<AcademicPage />);
  await screen.findByText("2027/2028");
  await user.click(screen.getAllByRole("button", { name: /Tambah Tahun Ajaran/ })[0]);
  const dialog = await screen.findByRole("dialog", { name: "Tambah Tahun Ajaran" });
  return { user, dialog };
}

describe("AcademicPage — Tambah Tahun Ajaran defaults (R2-ADMIN-15)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses the next year label as the name placeholder", async () => {
    stub();
    const { dialog } = await openAdd();
    expect(within(dialog).getByRole("textbox", { name: /Nama/ })).toHaveAttribute("placeholder", "2028/2029");
  });

  it("posts the day after the latest open year ends, one year less a day", async () => {
    const f = stub();
    const { user, dialog } = await openAdd();
    await user.type(within(dialog).getByRole("textbox", { name: /Nama/ }), "2028/2029");
    await user.click(within(dialog).getByRole("button", { name: "Tambah Tahun Ajaran" }));
    await waitFor(() => {
      const post = f.mock.calls.find(([u, i]) => u === "/api/academic-years" && (i as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        name: "2028/2029",
        startDate: "2028-07-10",
        endDate: "2029-07-09",
      });
    });
  });

  it("toasts the server's overlap message instead of the generic 'Periksa kolom yang ditandai'", async () => {
    const msg = "Rentang tanggal bertumpuk dengan tahun ajaran 2027/2028.";
    stub({ status: 400, body: { error: "Validasi gagal", errors: [{ field: "startDate", message: msg }] } });
    const { user, dialog } = await openAdd();
    await user.type(within(dialog).getByRole("textbox", { name: /Nama/ }), "2028/2029");
    await user.click(within(dialog).getByRole("button", { name: "Tambah Tahun Ajaran" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(msg));
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining("Periksa kolom"));
    expect(await within(dialog).findByText(msg)).toBeInTheDocument();
  });

  it("names where the roll-forward copies from", async () => {
    stub();
    const user = userEvent.setup();
    render(<AcademicPage />);
    await screen.findByText("2027/2028");
    await user.click(screen.getAllByRole("button", { name: /Aksi untuk|Buka menu/ })[0]);
    expect(await screen.findByRole("menuitem", { name: "Salin kelas dari tahun sebelumnya" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /ke Tahun Ini/ })).not.toBeInTheDocument();
  });
});
