/**
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the guardians list used to
 * render the name as a raw `<button onClick={() => router.push(...)}>`
 * *and* a separate "Lihat" row action doing the same navigation. Both are
 * now one `DataTableLinkCell` `<Link>`; `DataTableRowActions` no longer gets
 * `onView` for this list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import GuardiansPage from "@/app/admin/guardians/page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const guardian = {
  id: "g1",
  name: "Ibu Fatimah",
  email: "fatimah@example.com",
  phone: "081234567890",
  whatsapp: null,
  status: "ACTIVE",
  _count: { guardians: 1 },
  guardians: [{ student: { id: "s1", name: "Aisyah" } }],
};

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/guardians/stats") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ total: 12, active: 9, inactive: 3 }),
      } as Response);
    }
    if (url.includes("/api/guardians?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          capabilities: { canCreate: true, canEdit: true }, data: [guardian],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("GuardiansPage — name is the link (T7)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the guardian name as a link to the detail page and drops the separate Lihat button", async () => {
    render(<GuardiansPage />);

    await waitFor(() => {
      expect(screen.queryByText("Belum ada wali terdaftar")).not.toBeInTheDocument();
    });

    const nameLink = await screen.findByRole("link", { name: "Ibu Fatimah" });
    expect(nameLink).toHaveAttribute("href", "/admin/guardians/g1");
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();
  });

  it("links each named child to the student page (names are doors)", async () => {
    render(<GuardiansPage />);

    const childLinks = await screen.findAllByRole("link", { name: "Aisyah" });
    expect(childLinks.length).toBeGreaterThan(0);
    for (const link of childLinks) expect(link).toHaveAttribute("href", "/admin/students/s1");
  });
});

// T4 (2026-09-27, admin-forms-rhf) — the Edit Wali dialog now runs on
// react-hook-form + zodResolver (`parentFormSchema`, lib/validations/parent.ts)
// instead of a bare useState + fetch. `GuardianFormBody` itself is untouched
// (shared with the out-of-scope Student/Guardian detail pages), so a client
// validation failure has no inline field slot to render into — it surfaces
// as a toast instead (see the `handleEditSave` onInvalid handler).
describe("GuardiansPage — Edit Wali dialog (RHF)", () => {
  function stubFetchWithParent() {
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/guardians/stats") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ total: 12, active: 9, inactive: 3 }),
        } as Response);
      }
      if (url.includes("/api/guardians?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            capabilities: { canCreate: true, canEdit: true }, data: [guardian],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
        } as Response);
      }
      if (url.includes("/api/parents/g1") && (!init || init.method === undefined)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "g1",
            name: "Ibu Fatimah",
            email: "fatimah@example.com",
            phone: "081234567890",
            whatsapp: null,
            address: null,
            nik: null,
            education: null,
            occupation: null,
            employer: null,
            employerAddress: null,
            employerCity: null,
            incomeRange: null,
            childrenTotal: null,
            guardians: [],
          }),
        } as Response);
      }
      if (url.includes("/api/parents/g1") && init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "g1" }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetchWithParent());
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
    render(<GuardiansPage />);
    await screen.findByText("Ibu Fatimah");
    // Base UI Menu — real pointer sequence via userEvent, not fireEvent
    // (see app/admin/fees/__tests__/page.test.tsx for the same pattern).
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Ibu Fatimah" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    return screen.findByRole("dialog", { name: "Edit Wali" });
  }

  // T3 (2026-09-27, admin-finish-standard): the useWatch/setValue bridge is
  // gone — `GuardianFormBody` now takes `control` directly and renders
  // `name` with `FormField`, so a client-side validation failure has an
  // inline error slot to land on instead of a toast.
  it("blocks submit and shows an inline error when Nama is cleared, without sending a request", async () => {
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    const nameInput = await within(dialog).findByLabelText(/^Nama\*?$/);
    await user.clear(nameInput);

    const fetchSpy = vi.mocked(fetch);
    fetchSpy.mockClear();

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    expect(await within(dialog).findByText("Nama wajib diisi")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/parents/g1"),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it.each(["Escape", "Batal"])("protects an unsaved guardian draft on %s and discards only after confirmation", async (dismiss) => {
    const user = userEvent.setup();
    let dialog = await openEditDialog(user);
    const address = await within(dialog).findByLabelText("Alamat");
    await user.type(address, "Unsaved family address");
    if (dismiss === "Escape") await user.keyboard("{Escape}");
    else await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(await within(dialog).findByText("Buang perubahan?")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Lanjut mengisi" }));
    expect(address).toHaveValue("Unsaved family address");
    if (dismiss === "Escape") await waitFor(() => expect(address).toHaveFocus());
    else await waitFor(() => expect(within(dialog).getByLabelText(/^Nama\*?$/)).toHaveFocus());
    await user.click(address);
    await user.keyboard("{Escape}");
    expect(await within(dialog).findByText("Buang perubahan?")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(address).toHaveFocus());
    expect(address).toHaveValue("Unsaved family address");
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await user.click(within(dialog).getByRole("button", { name: "Buang perubahan" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Wali" })).not.toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Ibu Fatimah" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    dialog = await screen.findByRole("dialog", { name: "Edit Wali" });
    expect(await within(dialog).findByLabelText("Alamat")).toHaveValue("");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it("submits a PUT with the edited fields on a valid save", async () => {
    const user = userEvent.setup();
    const dialog = await openEditDialog(user);

    const phoneInput = await within(dialog).findByLabelText("No. HP");
    await user.clear(phoneInput);
    await user.type(phoneInput, "089999999999");

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Data wali diperbarui"));

    const putCall = vi.mocked(fetch).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const [putUrl, putInit] = putCall as [string, RequestInit];
    expect(putUrl).toContain("/api/parents/g1");
    const body = JSON.parse(putInit.body as string);
    expect(body.phone).toBe("089999999999");
    expect(body.name).toBe("Ibu Fatimah");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/guardians/stats")).toHaveLength(2));
  });
});

describe("Guardian summary requests", () => {
  const tile = (label: string) => screen.getByText(label, { selector: "p" }).closest("div.relative")!;

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", stubFetch());
  });

  it("loads one list and one aggregate request and renders all three totals", async () => {
    render(<GuardiansPage />);
    await screen.findByRole("link", { name: "Ibu Fatimah" });
    await waitFor(() => expect(tile("Total Wali")).toHaveTextContent("12"));
    expect(tile("Aktif")).toHaveTextContent("9");
    expect(tile("Tidak Aktif")).toHaveTextContent("3");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url).sort()).toEqual([
      "/api/guardians/stats",
      "/api/guardians?page=1&pageSize=20&sortBy=name&sortOrder=asc",
    ].sort());
  });

  it("renders zero totals for a successfully loaded empty tenant", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve({
      ok: true,
      json: async () => String(input) === "/api/guardians/stats"
        ? { total: 0, active: 0, inactive: 0 }
        : { capabilities: { canEdit: true }, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    } as Response)));
    render(<GuardiansPage />);
    await screen.findByText("Belum ada wali terdaftar");
    for (const label of ["Total Wali", "Aktif", "Tidak Aktif"]) {
      expect(tile(label)).toHaveTextContent("0");
      expect(tile(label)).not.toHaveTextContent("—");
    }
  });

  it.each(["http", "network"])("shows unknown totals and existing feedback on a %s failure", async (failure) => {
    const fallback = stubFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/guardians/stats") {
        return failure === "network" ? Promise.reject(new Error("offline"))
          : Promise.resolve({ ok: false, json: async () => ({ error: "Unavailable" }) } as Response);
      }
      return fallback(input);
    }));
    render(<GuardiansPage />);
    await screen.findByRole("link", { name: "Ibu Fatimah" });
    expect(tile("Total Wali")).toHaveTextContent("—");
    expect(tile("Aktif")).toHaveTextContent("—");
    expect(tile("Tidak Aktif")).toHaveTextContent("—");
    expect(toast.error).toHaveBeenCalledWith("Data belum bisa dimuat. Coba lagi sebentar ya.");
  });

  it("refreshes aggregate totals after changing a guardian's status", async () => {
    const user = userEvent.setup();
    let deactivated = false;
    const fallback = stubFetch();
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/parents/g1" && init?.method === "PATCH") {
        deactivated = true;
        return Promise.resolve({ ok: true } as Response);
      }
      if (String(input) === "/api/guardians/stats") {
        return Promise.resolve({ ok: true, json: async () => ({ total: 12, active: deactivated ? 8 : 9, inactive: deactivated ? 4 : 3 }) } as Response);
      }
      return fallback(input);
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<GuardiansPage />);
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Ibu Fatimah" }));
    await user.click(await screen.findByRole("menuitem", { name: "Nonaktifkan" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Nonaktifkan" }));
    await waitFor(() => expect(tile("Aktif")).toHaveTextContent("8"));
    expect(tile("Tidak Aktif")).toHaveTextContent("4");
    expect(fetchSpy.mock.calls.filter(([url]) => url === "/api/guardians/stats")).toHaveLength(2);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("pageSize=1&"))).toBe(false);
  });
});

describe("Guardian edit detail loading", () => {
  it("blocks partial saves after a failed load and retries with all stored fields", async () => {
    const user = userEvent.setup();
    let detailFails = true;
    const fallback = stubFetch();
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/parents/g1") {
        if (init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
        return Promise.resolve({ ok: !detailFails, json: async () => ({ ...guardian, address: "Stored address", nik: "1234567890123456", occupation: "Guru", employer: "Stored employer" }) } as Response);
      }
      return fallback(input);
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<GuardiansPage />);
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Ibu Fatimah" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Wali" });
    expect(await within(dialog).findByText("Data wali belum bisa dimuat")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();
    expect(within(dialog).queryByLabelText("No. HP")).not.toBeInTheDocument();
    detailFails = false;
    await user.click(within(dialog).getByRole("button", { name: "Coba Lagi" }));
    expect(await within(dialog).findByDisplayValue("Stored address")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("/api/parents/g1", expect.objectContaining({ method: "PUT" })));
    const saved = fetchSpy.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(saved[1]!.body as string)).toMatchObject({ address: "Stored address", parentNik: "1234567890123456", occupation: "Guru", employer: "Stored employer" });
  });

  it("ignores an old response after closing and opening a different guardian", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const other = { ...guardian, id: "g2", name: "Other Guardian" };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/parents/g1") return first;
      if (url === "/api/parents/g2") return Promise.resolve({ ok: true, json: async () => ({ ...other, address: "Other address" }) } as Response);
      return Promise.resolve({ ok: true, json: async () => ({ capabilities: { canCreate: true, canEdit: true }, data: [guardian, other], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } }) } as Response);
    }));
    render(<GuardiansPage />);
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Ibu Fatimah" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const firstDialog = await screen.findByRole("dialog", { name: "Edit Wali" });
    expect(await within(firstDialog).findByText("Memuat data wali...")).toBeInTheDocument();
    await user.click(within(firstDialog).getByRole("button", { name: "Batal" }));
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Other Guardian" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Wali" });
    const name = await within(dialog).findByDisplayValue("Other Guardian");
    await user.clear(name);
    await user.type(name, "Edited other guardian");
    await act(async () => {
      resolveFirst({ ok: true, json: async () => ({ ...guardian, address: "First address" }) } as Response);
    });
    expect(name).toHaveValue("Edited other guardian");
    expect(within(dialog).getByDisplayValue("Other address")).toBeInTheDocument();
  });
});


describe("Guardian search ordering", () => {
  it("keeps the latest query results when an earlier search finishes last", async () => {
    const user = userEvent.setup();
    let resolveOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => { resolveOlder = resolve; });
    const latest = { ...guardian, name: "Latest Guardian" };
    const fallback = stubFetch();
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const search = new URL(String(input), "http://localhost").searchParams.get("search");
      if (search === "old") return older;
      if (search === "latest") return Promise.resolve({ ok: true, json: async () => ({ capabilities: { canCreate: true, canEdit: true }, data: [latest], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) } as Response);
      return fallback(input);
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<GuardiansPage />);
    await screen.findByText("Ibu Fatimah");
    const search = screen.getByPlaceholderText("Cari nama, email, atau telepon...");
    await user.type(search, "old");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("search=old")));
    await user.clear(search);
    await user.type(search, "latest");
    expect(await screen.findByText("Latest Guardian")).toBeInTheDocument();
    await act(async () => {
      resolveOlder({ ok: true, json: async () => ({ capabilities: { canCreate: true, canEdit: true }, data: [guardian], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) } as Response);
    });
    expect(screen.getByText("Latest Guardian")).toBeInTheDocument();
    expect(screen.queryByText("Ibu Fatimah")).not.toBeInTheDocument();
  });
});


describe("Guardian filtered empty state", () => {
  it("describes no search matches rather than claiming no guardians are registered", async () => {
    const user = userEvent.setup();
    const fallback = stubFetch();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (new URL(String(input), "http://localhost").searchParams.get("search") === "no-match") {
        return Promise.resolve({ ok: true, json: async () => ({ capabilities: { canEdit: true }, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) } as Response);
      }
      return fallback(input);
    }));
    render(<GuardiansPage />);
    await screen.findByRole("link", { name: "Ibu Fatimah" });
    const search = screen.getByPlaceholderText("Cari nama, email, atau telepon...");
    await user.type(search, "no-match");
    expect(await screen.findByText("Tidak ada hasil yang cocok")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada wali terdaftar")).not.toBeInTheDocument();
    await user.clear(search);
    expect(await screen.findByRole("link", { name: "Ibu Fatimah" })).toBeInTheDocument();
  });
});
