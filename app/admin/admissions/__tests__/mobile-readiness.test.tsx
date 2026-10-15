import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdmissionsPage from "@/app/admin/admissions/page";
import { ClassesClient } from "@/app/admin/classes/client";
import { navStore } from "./helpers";

vi.mock("next/navigation", async () => (await import("./helpers")).navigationMock());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const year = { id: "audit-year", name: "2026/2027", status: "ACTIVE", startDate: "2026-07-01", endDate: "2027-06-30" };
const admission = {
  id: "audit-admission", childName: "AUDIT admission", parentName: "AUDIT guardian", status: "INQUIRY",
  childAge: null, dateOfBirth: null, childGender: null, parentPhone: null, parentWhatsapp: null,
  parentEmail: null, parentRelationship: null, programId: null, source: "WALK_IN", notes: null,
  studentId: null, createdAt: "2026-10-10", program: null, detectedParent: null,
  stage: "BARU", payment: "NONE", application: null,
};
const klass = {
  id: "audit-class", name: "AUDIT class", capacity: 20, slotTemplate: "FULL_DAY", ageGroup: "A",
  status: "ACTIVE", campusId: "audit-campus", programId: "audit-program", academicYearId: year.id,
  classTrackId: "audit-track", campus: { id: "audit-campus", name: "AUDIT campus" },
  program: { id: "audit-program", name: "AUDIT program", code: "TK" }, academicYear: year,
  enrolledCount: 1, attendance7dPct: 100, todaySession: "Held", health: "Sehat", teachingAssignments: [],
};
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data }) as Response;
const modules = [
  { name: "admissions", render: () => render(<AdmissionsPage />), row: admission, rowName: admission.childName,
    endpoint: "/api/admissions", query: "search", search: "Cari nama anak atau orang tua...",
    empty: "Belum ada calon siswa. Catat pertanyaan pertama.", error: "Gagal memuat data pendaftaran. Coba lagi.",
    trigger: "Catat Pertanyaan", dialog: "Catat Pertanyaan Baru", field: /^Nama orang tua\*?$/, edit: "Ubah data pertanyaan", editDialog: "Ubah data pertanyaan" },
  { name: "classes", render: () => render(<ClassesClient canWrite={true} />), row: klass, rowName: klass.name,
    endpoint: "/api/admin/classes", query: "q", search: "Cari nama kelas...",
    empty: "Belum ada kelas", error: "Gagal memuat daftar kelas. Coba lagi.",
    trigger: "Tambah Kelas", dialog: "Tambah Kelas", field: /^Nama kelas\*?$/, edit: "Ubah", editDialog: "Ubah Kelas" },
];

beforeEach(() => navStore.reset());

for (const m of modules) {
  const payload = (rows: unknown[]) => ({ data: rows, canEdit: true, pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 } });
  function serve(read: (url: URL) => Response | Promise<Response>) {
    const mock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === m.endpoint && url.searchParams.get("pageSize") !== "1") return Promise.resolve(read(url));
      if (url.pathname === "/api/academic-years") return Promise.resolve(response([year]));
      if (url.pathname === "/api/admissions") return Promise.resolve(response(payload([])));
      return Promise.resolve(response([]));
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  describe(`${m.name} — interrupted mobile list and draft flows`, () => {
    it("shows initial read failure separately from empty and retries", async () => {
      let fail = true;
      serve(() => fail ? response({ error: "intercepted" }, false) : response(payload([m.row])));
      const user = userEvent.setup(); m.render();
      expect(await screen.findByText(m.error)).toBeInTheDocument();
      expect(screen.queryByText(m.empty)).not.toBeInTheDocument();
      fail = false; await user.click(screen.getByRole("button", { name: "Coba lagi" }));
      expect(await screen.findByText(m.rowName)).toBeInTheDocument();
      expect(screen.queryByText(m.error)).not.toBeInTheDocument();
    });
    it("preserves last successful rows on a failed refresh, then retries current search", async () => {
      let fail = true;
      serve(url => url.searchParams.get(m.query) ? fail ? Promise.reject(new Error("network interrupted")) : response(payload([])) : response(payload([m.row])));
      const user = userEvent.setup(); m.render(); await screen.findByText(m.rowName);
      await user.type(screen.getByPlaceholderText(m.search), "AUDIT missing");
      await screen.findByText(m.error);
      expect(screen.getByText(m.rowName)).toBeInTheDocument();
      expect(screen.getByText("Daftar terakhir masih ditampilkan dan belum diperbarui.")).toBeInTheDocument();
      fail = false; await user.click(screen.getByRole("button", { name: "Coba lagi" }));
      expect(await screen.findByText("Tidak ada hasil yang cocok")).toBeInTheDocument();
      expect(screen.queryByText(m.rowName)).not.toBeInTheDocument();
    });
    it("uses first-run copy only for an unfiltered successful empty read", async () => {
      serve(() => response(payload([])));
      const user = userEvent.setup(); m.render(); await screen.findByText(m.empty);
      await user.type(screen.getByPlaceholderText(m.search), "AUDIT absent");
      expect(await screen.findByText("Tidak ada hasil yang cocok")).toBeInTheDocument();
      expect(screen.queryByText(m.empty)).not.toBeInTheDocument();
      await user.clear(screen.getByPlaceholderText(m.search));
      expect(await screen.findByText(m.empty)).toBeInTheDocument();
    });
    it("ignores a delayed failed older search after a newer search succeeds", async () => {
      let resolveOld: (response: Response) => void = () => {};
      const mock = serve(url => url.searchParams.get(m.query) === "old" ? new Promise<Response>(resolve => { resolveOld = resolve; }) : response(payload([m.row])));
      const user = userEvent.setup(); m.render(); await screen.findByText(m.rowName);
      const search = screen.getByPlaceholderText(m.search);
      await user.type(search, "old");
      await waitFor(() => expect(mock.mock.calls.some(([url]) => new URL(String(url), "http://localhost").searchParams.get(m.query) === "old")).toBe(true));
      await user.clear(search); await user.type(search, "new");
      await waitFor(() => expect(mock.mock.calls.some(([url]) => new URL(String(url), "http://localhost").searchParams.get(m.query) === "new")).toBe(true));
      await screen.findByText(m.rowName);
      await act(async () => { resolveOld(response({ error: "old failure" }, false)); });
      expect(screen.queryByText(m.error)).not.toBeInTheDocument();
      expect(screen.getByText(m.rowName)).toBeInTheDocument();
    });
    it("dirty Escape and Cancel keep the create draft; explicit discard resets it", async () => {
      serve(() => response(payload([m.row])));
      const user = userEvent.setup(); m.render(); await screen.findByText(m.rowName);
      await user.click(screen.getByRole("button", { name: m.trigger }));
      let dialog = await screen.findByRole("dialog", { name: m.dialog });
      const field = within(dialog).getByLabelText(m.field);
      await user.type(field, "AUDIT unsaved draft"); await user.keyboard("{Escape}");
      expect(await within(dialog).findByText("Buang perubahan?")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Lanjut mengisi" })).toHaveFocus();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      await user.keyboard("{Escape}");
      await waitFor(() => expect(field).toHaveFocus());
      expect(field).toHaveValue("AUDIT unsaved draft");
      await user.click(within(dialog).getByRole("button", { name: "Batal" }));
      await user.click(within(dialog).getByRole("button", { name: "Lanjut mengisi" }));
      expect(field).toHaveValue("AUDIT unsaved draft");
      await user.click(within(dialog).getByRole("button", { name: "Batal" }));
      await user.click(within(dialog).getByRole("button", { name: "Buang perubahan" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: m.dialog })).not.toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: m.trigger }));
      dialog = await screen.findByRole("dialog", { name: m.dialog });
      expect(within(dialog).getByLabelText(m.field)).toHaveValue("");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: m.dialog })).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: m.trigger })).toHaveFocus();
    });
    it("dirty edit dismissal preserves the row values until explicit discard", async () => {
      serve(() => response(payload([m.row])));
      const user = userEvent.setup(); m.render(); await screen.findByText(m.rowName);
      await user.click(screen.getByRole("button", { name: /aksi|menu|lainnya/i }));
      await user.click(await screen.findByRole("menuitem", { name: m.edit }));
      const dialog = await screen.findByRole("dialog", { name: m.editDialog });
      const field = within(dialog).getByLabelText(m.field);
      await user.clear(field); await user.type(field, "AUDIT changed"); await user.keyboard("{Escape}");
      await within(dialog).findByText("Buang perubahan?");
      await user.click(within(dialog).getByRole("button", { name: "Lanjut mengisi" }));
      expect(field).toHaveValue("AUDIT changed");
    });
  });
}
