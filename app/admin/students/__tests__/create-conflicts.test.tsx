/**
 * ADM-2 (UI) — the create / edit student dialogs against the server's 409s:
 *   NIS_TAKEN          → inline error on the NIS field
 *   DUPLICATE_STUDENT  → confirm step ("Lihat siswa" / "Tetap simpan"); the
 *                        confirm re-POSTs the same body plus confirmDuplicate: true
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentsPage from "@/app/admin/students/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

type Post = { body: Record<string, unknown> };
let posts: Post[] = [];
let puts: Post[] = [];
let postResponses: Array<{ ok: boolean; status: number; json: () => Promise<unknown> }> = [];
let putResponse: { ok: boolean; status: number; json: () => Promise<unknown> } = {
  ok: true,
  status: 200,
  json: async () => ({}),
};

const rowStudent = {
  id: "s1", name: "Aisyah Putri", nickname: null, dateOfBirth: null, gender: null, status: "ACTIVE",
  nis: "001", nisn: null, notes: null, photoUrl: null, createdAt: "2026-01-01T00:00:00.000Z",
  guardians: [], enrollments: [],
};

function stubFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.includes("/api/students/stats")) {
      return Promise.resolve({ ok: true, json: async () => ({ total: 0, active: 0, graduated: 0 }) } as Response);
    }
    if (url === "/api/students" && method === "POST") {
      posts.push({ body: JSON.parse(init!.body as string) });
      return Promise.resolve(postResponses.shift() as unknown as Response);
    }
    if (url === "/api/students/s1" && method === "PUT") {
      puts.push({ body: JSON.parse(init!.body as string) });
      return Promise.resolve(putResponse as unknown as Response);
    }
    if (url === "/api/students/s1") {
      return Promise.resolve({ ok: true, json: async () => ({ ...rowStudent, address: null, birthPlace: null, nik: null, kkNumber: null, livingWith: null }) } as Response);
    }
    if (url.includes("/api/students?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ capabilities: { canCreate: true, canEdit: true }, data: [rowStudent], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

async function fillAndSubmitCreate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Aisyah Putri");
  await user.click(await screen.findByRole("button", { name: "Tambah Siswa" }));
  const dialog = await screen.findByRole("dialog", { name: "Tambah Siswa" });
  await user.type(within(dialog).getByLabelText(/^Nama Lengkap\*?$/), "Budi Santoso");
  await user.type(within(dialog).getByLabelText("NIS"), "001");
  await user.click(within(dialog).getByRole("button", { name: "Tambah Siswa" }));
  return dialog;
}

describe("StudentsPage — create conflicts (ADM-2)", () => {
  beforeEach(() => {
    posts = [];
    puts = [];
    push.mockClear();
    putResponse = { ok: true, status: 200, json: async () => ({}) };
    vi.stubGlobal("fetch", stubFetch());
  });

  it("NIS_TAKEN shows an inline error on the NIS field and keeps the dialog open", async () => {
    postResponses = [
      {
        ok: false,
        status: 409,
        json: async () => ({ error: "NIS 001 sudah dipakai siswa lain (Aisyah Putri).", code: "NIS_TAKEN", field: "nis" }),
      },
    ];
    const user = userEvent.setup();
    render(<StudentsPage />);
    const dialog = await fillAndSubmitCreate(user);

    expect(await within(dialog).findByText("NIS 001 sudah dipakai siswa lain (Aisyah Putri).")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("NIS")).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();
    expect(posts).toHaveLength(1);
  });

  it("DUPLICATE_STUDENT opens a confirm with Lihat siswa; Tetap simpan re-POSTs with confirmDuplicate: true", async () => {
    postResponses = [
      {
        ok: false,
        status: 409,
        json: async () => ({
          error: "Siswa dengan nama dan tanggal lahir yang sama sudah ada (Budi Santoso).",
          code: "DUPLICATE_STUDENT",
          existingId: "s-existing",
        }),
      },
      { ok: true, status: 201, json: async () => ({ id: "s-new" }) },
    ];
    const user = userEvent.setup();
    render(<StudentsPage />);
    await fillAndSubmitCreate(user);

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Siswa dengan nama dan tanggal lahir yang sama sudah ada/)).toBeInTheDocument();
    expect(within(confirm).getByRole("link", { name: "Lihat siswa" })).toHaveAttribute("href", "/admin/students/s-existing");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).not.toHaveProperty("confirmDuplicate");

    await user.click(within(confirm).getByRole("button", { name: "Tetap simpan" }));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toMatchObject({ ...posts[0].body, confirmDuplicate: true });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/students/s-new"));
  });

  it("Batal on the duplicate confirm saves nothing", async () => {
    postResponses = [
      { ok: false, status: 409, json: async () => ({ error: "Sudah ada.", code: "DUPLICATE_STUDENT", existingId: "s-existing" }) },
    ];
    const user = userEvent.setup();
    render(<StudentsPage />);
    await fillAndSubmitCreate(user);

    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Batal" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(posts).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("editing to a taken NIS puts the 409 message on the NIS field", async () => {
    putResponse = {
      ok: false,
      status: 409,
      json: async () => ({ error: "NIS 002 sudah dipakai siswa lain.", code: "NIS_TAKEN", field: "nis" }),
    };
    const user = userEvent.setup();
    render(<StudentsPage />);

    await screen.findByText("Aisyah Putri");
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Aisyah Putri" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Siswa" });
    const nis = await within(dialog).findByLabelText("NIS");
    await waitFor(() => expect(nis).toHaveValue("001"));
    await user.clear(nis);
    await user.type(nis, "002");
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    expect(await within(dialog).findByText("NIS 002 sudah dipakai siswa lain.")).toBeInTheDocument();
    expect(puts).toHaveLength(1);
  });
});
