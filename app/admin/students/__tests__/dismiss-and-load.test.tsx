import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentsPage from "@/app/admin/students/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const student = {
  id: "synthetic-student", name: "Synthetic Student", nickname: null, gender: "P",
  dateOfBirth: null, status: "ACTIVE", nis: null, nisn: null, notes: null,
  photoUrl: null, createdAt: "2026-01-01", guardians: [], enrollments: [],
};
const full = { ...student, address: "Synthetic address", birthPlace: "Bekasi", nik: null, kkNumber: null, livingWith: null };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
let load: () => Promise<Response>;
let puts: unknown[];

beforeEach(() => {
  load = async () => response(full);
  puts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/students/stats") return response({ total: 1, active: 1, graduated: 0 });
    if (url.startsWith("/api/students?")) return response({ data: [student], capabilities: { canCreate: true, canEdit: true }, pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    if (url === `/api/students/${student.id}`) {
      if (init?.method === "PUT") { puts.push(JSON.parse(init.body as string)); return response(full); }
      return load();
    }
    throw new Error(`Unexpected request ${url}`);
  }));
});

async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Aksi untuk Synthetic Student" }));
  await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
  return screen.findByRole("dialog", { name: "Edit Siswa" });
}

describe("student form dismissal and initial load", () => {
  it("Escape and cancel preserve a dirty create draft until explicit discard, with one overlay and safe focus", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />);
    await user.click(await screen.findByRole("button", { name: "Tambah Siswa" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Siswa" });
    const name = within(dialog).getByLabelText(/Nama Lengkap/);
    await user.type(name, "Synthetic draft");
    await user.keyboard("{Escape}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Buang perubahan?");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Lanjut mengisi" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveValue("Synthetic draft");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await user.click(within(dialog).getByRole("button", { name: "Lanjut mengisi" }));
    expect(name).toHaveValue("Synthetic draft");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await user.click(within(dialog).getByRole("button", { name: "Buang perubahan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Tambah Siswa" }));
    expect(screen.getByLabelText(/Nama Lengkap/)).toHaveValue("");
    expect(puts).toHaveLength(0);
  });

  it("a clean create form closes immediately and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />);
    const trigger = await screen.findByRole("button", { name: "Tambah Siswa" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("failed edit load has no editable fields or enabled save; retry loads the full record before saving", async () => {
    load = async () => response({ error: "failed" }, false);
    const user = userEvent.setup();
    render(<StudentsPage />);
    const dialog = await edit(user);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Data belum bisa diubah");
    expect(within(dialog).getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
    expect(within(dialog).queryByLabelText(/Nama Lengkap/)).not.toBeInTheDocument();
    expect(puts).toHaveLength(0);
    load = async () => response(full);
    await user.click(within(dialog).getByRole("button", { name: "Coba lagi" }));
    const name = await within(dialog).findByLabelText(/Nama Lengkap/);
    await user.clear(name);
    await user.type(name, "Synthetic corrected");
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ name: "Synthetic corrected", address: "Synthetic address", birthPlace: "Bekasi" });
  });

  it("cancelling a pending edit ignores its delayed response after reopening; dirty edit requires explicit discard", async () => {
    let resolveFirst!: (value: Response) => void;
    load = () => new Promise((resolve) => { resolveFirst = resolve; });
    const user = userEvent.setup();
    render(<StudentsPage />);
    let dialog = await edit(user);
    expect(within(dialog).getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Memuat data siswa");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    load = async () => response({ ...full, name: "Synthetic latest" });
    dialog = await edit(user);
    const name = await within(dialog).findByLabelText(/Nama Lengkap/);
    await waitFor(() => expect(name).toHaveValue("Synthetic latest"));
    resolveFirst(response({ ...full, name: "Stale response" }));
    await user.type(name, " changed");
    expect(name).toHaveValue("Synthetic latest changed");
    await user.keyboard("{Escape}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Buang perubahan?");
    await user.click(within(dialog).getByRole("button", { name: "Lanjut mengisi" }));
    await waitFor(() => expect(name).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Buang perubahan?");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveValue("Synthetic latest changed");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await user.click(within(dialog).getByRole("button", { name: "Lanjut mengisi" }));
    expect(name).toHaveValue("Synthetic latest changed");
    expect(puts).toHaveLength(0);
  });
});
