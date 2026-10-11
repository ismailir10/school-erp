/**
 * T2 (cycle 2026-09-25, Pendaftaran merge) — /admin/admissions and
 * /admin/enrollments used to be two separate, confusingly-named nav
 * entries. They're now one "Pendaftaran" entry with a link-tab strip
 * ("Calon Siswa" / "Formulir") under the PageHeader so the admin can tell
 * which sub-view they're in and jump to the other. This guards that the
 * strip renders on the admissions page with "Calon Siswa" marked current.
 *
 * Companion coverage for the conversion-eligibility logic lives in
 * `page.test.ts` (node env, no DOM) — unchanged by this cycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdmissionsPage from "@/app/admin/admissions/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/admissions",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/admissions")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          canEdit: true,
        }),
      } as Response);
    }
    if (url.includes("/api/programs")) {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("AdmissionsPage — Pendaftaran tab strip", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the Calon Siswa / Formulir strip with Calon Siswa marked current", async () => {
    render(<AdmissionsPage />);

    const calonSiswa = await screen.findByRole("link", { name: "Calon Siswa" });
    expect(calonSiswa).toHaveAttribute("href", "/admin/admissions");
    expect(calonSiswa).toHaveAttribute("aria-current", "page");

    const formulir = screen.getByRole("link", { name: "Formulir" });
    expect(formulir).toHaveAttribute("href", "/admin/enrollments");
    expect(formulir).not.toHaveAttribute("aria-current");
  });
});

// T4 (2026-09-27, admin-forms-rhf) — "Catat Pertanyaan" now runs on
// react-hook-form + zodResolver (`createAdmissionSchema`, reused as-is —
// every field the form edits already used `optionalTrimmed`/`optionalEnum`).
describe("AdmissionsPage — Catat Pertanyaan dialog (RHF)", () => {
  function stubFetchTrackingPost() {
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/admissions") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ id: "a1" }) } as Response);
      }
      if (url.includes("/api/admissions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
            canEdit: true,
          }),
        } as Response);
      }
      if (url.includes("/api/programs")) {
        return Promise.resolve({ ok: true, json: async () => [] } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetchTrackingPost());
  });

  it("blocks an empty submit with inline errors and sends no request", async () => {
    const user = userEvent.setup();
    render(<AdmissionsPage />);

    await user.click(await screen.findByRole("button", { name: "Catat Pertanyaan" }));
    const dialog = await screen.findByRole("dialog", { name: "Catat Pertanyaan Baru" });

    const fetchSpy = vi.mocked(fetch);
    fetchSpy.mockClear();

    await user.click(within(dialog).getByRole("button", { name: "Catat Pertanyaan" }));

    expect(await within(dialog).findByText("Nama orang tua wajib diisi")).toBeInTheDocument();
    expect(within(dialog).queryByText("Nama anak wajib diisi")).not.toBeInTheDocument();
    expect(
      fetchSpy.mock.calls.some(
        ([reqUrl, init]) => String(reqUrl).includes("/api/admissions") && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("asks for one contact when only the parent name is filled", async () => {
    const user = userEvent.setup();
    render(<AdmissionsPage />);

    await user.click(await screen.findByRole("button", { name: "Catat Pertanyaan" }));
    const dialog = await screen.findByRole("dialog", { name: "Catat Pertanyaan Baru" });
    await user.type(within(dialog).getByLabelText(/^Nama orang tua\*?$/), "Ibu Fatimah");
    vi.mocked(fetch).mockClear();

    await user.click(within(dialog).getByRole("button", { name: "Catat Pertanyaan" }));

    expect(await within(dialog).findByText("Isi minimal satu kontak: No. HP, WhatsApp atau Email")).toBeInTheDocument();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  it("saves with only the parent name and a phone; the child fields stay out of the way", async () => {
    const user = userEvent.setup();
    render(<AdmissionsPage />);

    await user.click(await screen.findByRole("button", { name: "Catat Pertanyaan" }));
    const dialog = await screen.findByRole("dialog", { name: "Catat Pertanyaan Baru" });

    // The child section is collapsed on a new lead; the removed lead fields are gone.
    expect(within(dialog).getByRole("button", { name: "Data anak (opsional)" })).toBeInTheDocument();
    for (const gone of [/Pendidikan/, /Pekerjaan/, /Penghasilan/, /Preferensi Kampus/, /Tanggal Tindak Lanjut/, /Sumber/]) {
      expect(within(dialog).queryByLabelText(gone)).not.toBeInTheDocument();
    }

    await user.type(within(dialog).getByLabelText(/^Nama orang tua\*?$/), "Ibu Fatimah");
    await user.type(within(dialog).getByLabelText("No. HP"), "081234567890");
    await user.click(within(dialog).getByRole("button", { name: "Catat Pertanyaan" }));

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pendaftaran tercatat"));

    const postCall = vi.mocked(fetch).mock.calls.find(
      ([reqUrl, init]) => String(reqUrl).includes("/api/admissions") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const [, postInit] = postCall as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.parentName).toBe("Ibu Fatimah");
    expect(body.parentPhone).toBe("081234567890");
    expect(body.childName).toBe("");
    for (const key of ["source", "parentEducation", "parentOccupation", "parentIncome", "campusPreference", "followUpDate"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("sends a cleared email as blank when editing, so the server can clear it", async () => {
    const lead = {
      id: "a1", childName: "", status: "INQUIRY", childAge: null, dateOfBirth: null, childGender: null,
      parentName: "Ibu Fatimah", parentPhone: "081234567890", parentWhatsapp: null, parentEmail: "fatimah@example.com",
      parentRelationship: null, programId: null, source: "WALK_IN", notes: null,
      studentId: null, createdAt: "2026-10-01T00:00:00.000Z", program: null,
      detectedParentId: null, detectedParent: null,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/admissions") && init?.method === "PUT") {
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }
      if (url.includes("/api/admissions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [lead], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, canEdit: true }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Ibu Fatimah", { exact: false });
    await user.click(screen.getByRole("button", { name: /aksi|menu|lainnya/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Pendaftaran" });

    await user.clear(within(dialog).getByLabelText("Email"));
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const putInit = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")![1]!;
    const body = JSON.parse(putInit.body as string);
    expect(body.parentEmail).toBe("");
    expect(body.parentPhone).toBe("081234567890");
    expect(body.childName).toBe("");
  });
});

// "Terima" (VISITED → ADMITTED) commits the family, so it asks first; the
// earlier pipeline steps stay one-click.
describe("AdmissionsPage — Terima confirm", () => {
  const row = (id: string, childName: string, status: string) => ({
    id, childName, status, childAge: null, dateOfBirth: null, childGender: null,
    parentName: "Ibu Fatimah", parentPhone: null, parentWhatsapp: null, parentEmail: null,
    parentEducation: null, parentOccupation: null, parentIncome: null, parentRelationship: null,
    programId: null, campusPreference: null, source: "WHATSAPP", notes: null, followUpDate: null,
    studentId: null, createdAt: "2026-10-01T00:00:00.000Z", program: null,
    detectedParentId: null, detectedParent: null,
  });

  function serve(status: string) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/admissions") && init?.method === "PUT") {
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }
      if (url.includes("/api/admissions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [row("a1", "Aisyah", status)],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
            canEdit: true,
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const puts = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([, init]) => init?.method === "PUT");

  async function openAdvance(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Aisyah");
    await user.click(screen.getByRole("button", { name: /aksi|menu|lainnya/i }));
  }

  it("asks before moving a VISITED inquiry to ADMITTED", async () => {
    const fetchMock = serve("VISITED");
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openAdvance(user);
    await user.click(await screen.findByRole("menuitem", { name: "Terima" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Terima pendaftaran Aisyah?")).toBeInTheDocument();
    expect(puts(fetchMock)).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Terima" }));
    await waitFor(() => expect(puts(fetchMock)).toHaveLength(1));
    expect(JSON.parse(puts(fetchMock)[0][1]!.body as string)).toEqual({ status: "ADMITTED" });
  });

  it("keeps earlier steps one-click (no confirm for Jadwalkan kunjungan)", async () => {
    const fetchMock = serve("INQUIRY");
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openAdvance(user);
    await user.click(await screen.findByRole("menuitem", { name: "Jadwalkan kunjungan" }));

    await waitFor(() => expect(puts(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

// ── Round-2 fixes (2026-10-08): R2-ADMIN-1 / 14 / 16 ────────────────────────
const baseRow = (over: Record<string, unknown> = {}) => ({
  id: "a1", childName: "Aisyah", status: "INQUIRY", childAge: null, dateOfBirth: null, childGender: null,
  parentName: "Dewi Sartika", parentPhone: null, parentWhatsapp: null, parentEmail: null,
  parentEducation: null, parentOccupation: null, parentIncome: null, parentRelationship: null,
  programId: null, campusPreference: null, source: "WHATSAPP", notes: null, followUpDate: null,
  studentId: null, createdAt: "2026-10-01T00:00:00.000Z", program: null,
  detectedParentId: null, detectedParent: null,
  ...over,
});

function serveRows(rows: unknown[], extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const custom = extra?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.includes("/api/admissions") && (!init?.method || init.method === "GET")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: rows,
          pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
          canEdit: true,
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => [] } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AdmissionsPage — list contact + status naming (R2-ADMIN-14, 16)", () => {
  it("shows the WhatsApp number when parentPhone is empty", async () => {
    serveRows([baseRow({ parentWhatsapp: "08215678901" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByText(/Dewi Sartika · WA 08215678901/)).toBeInTheDocument();
  });

  it("prefers the phone over the WhatsApp number when both exist", async () => {
    serveRows([baseRow({ parentPhone: "0811111111", parentWhatsapp: "08215678901" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByText(/Dewi Sartika · 0811111111/)).toBeInTheDocument();
    expect(screen.queryByText(/WA 08215678901/)).not.toBeInTheDocument();
  });

  it("labels a converted ADMITTED row 'Diterima', matching the stat card (never 'Terdaftar')", async () => {
    serveRows([baseRow({ status: "ADMITTED", studentId: "stu-1" })]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(screen.queryByText("Terdaftar")).not.toBeInTheDocument();
    // stat card + filter option + the row chips all use the one name
    expect(screen.getAllByText("Diterima").length).toBeGreaterThanOrEqual(3);
  });

  it("renders a status chip under the child's name for phones (hidden from md up)", async () => {
    serveRows([baseRow({ status: "VISITED" })]);
    render(<AdmissionsPage />);
    const name = await screen.findByText("Aisyah");
    const cell = name.closest("div")!.parentElement!;
    const chipWrap = cell.querySelector(".md\\:hidden");
    expect(chipWrap).not.toBeNull();
    expect(within(chipWrap as HTMLElement).getByText("Sudah Kunjungan")).toBeInTheDocument();
  });

  it("puts a gap under the Calon Siswa / Formulir tab strip", async () => {
    serveRows([]);
    render(<AdmissionsPage />);
    const tab = await screen.findByRole("link", { name: "Calon Siswa" });
    expect(tab.parentElement).toHaveClass("mb-4");
  });
});

describe("AdmissionsPage — possible duplicate on convert (R2-ADMIN-1)", () => {
  const dupResponse = () =>
    ({
      ok: false,
      status: 409,
      json: async () => ({
        error: "POSSIBLE_DUPLICATE",
        code: "POSSIBLE_DUPLICATE",
        existingStudents: [{ id: "stu-old", name: "Aisyah Putri Ramadhani", status: "ACTIVE" }],
        existingParent: { id: "par-old", name: "Dewi Sartika Ramadhani" },
      }),
    }) as Response;

  async function clickConvert(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Aisyah");
    await user.click(screen.getByRole("button", { name: /aksi|menu|lainnya/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Konversi ke Siswa" }));
  }
  const convertPosts = (f: ReturnType<typeof serveRows>) =>
    f.mock.calls.filter(([u, init]) => String(u).endsWith("/convert") && init?.method === "POST");

  it("shows the existing student + wali with Lihat links, and re-sends with confirmDuplicate on 'Tetap konversi'", async () => {
    let first = true;
    const fetchMock = serveRows([baseRow({ status: "ADMITTED" })], (url, init) => {
      if (url.endsWith("/convert") && init?.method === "POST") {
        if (first) {
          first = false;
          return dupResponse();
        }
        return { ok: true, status: 200, json: async () => ({ student: { id: "stu-new" } }) } as Response;
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickConvert(user);

    const dialog = await screen.findByRole("dialog", { name: "Kemungkinan sudah terdaftar" });
    expect(within(dialog).getByText(/Kemungkinan siswa\/wali ini sudah terdaftar/)).toBeInTheDocument();
    expect(within(dialog).getByText("Aisyah Putri Ramadhani")).toBeInTheDocument();
    expect(within(dialog).getByText("Dewi Sartika Ramadhani")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Lihat Aisyah Putri Ramadhani" })).toHaveAttribute(
      "href",
      "/admin/students/stu-old",
    );
    expect(within(dialog).getByRole("link", { name: "Lihat Dewi Sartika Ramadhani" })).toHaveAttribute(
      "href",
      "/admin/guardians/par-old",
    );
    expect(JSON.parse(convertPosts(fetchMock)[0][1]!.body as string)).toEqual({ mergeWithDetected: true });

    await user.click(within(dialog).getByRole("button", { name: "Tetap konversi" }));
    await waitFor(() => expect(convertPosts(fetchMock)).toHaveLength(2));
    expect(JSON.parse(convertPosts(fetchMock)[1][1]!.body as string)).toEqual({
      mergeWithDetected: true,
      confirmDuplicate: true,
    });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dikonversi menjadi siswa"));
  });

  it("'Batal' leaves it unconverted (no second request)", async () => {
    const fetchMock = serveRows([baseRow({ status: "ADMITTED" })], (url, init) =>
      url.endsWith("/convert") && init?.method === "POST" ? dupResponse() : undefined,
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickConvert(user);
    const dialog = await screen.findByRole("dialog", { name: "Kemungkinan sudah terdaftar" });
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(convertPosts(fetchMock)).toHaveLength(1);
  });
});

describe("AdmissionsPage — Kirim Formulir result card", () => {
  const invite = (body: Record<string, unknown>) => (url: string, init?: RequestInit) =>
    url.endsWith("/api/enrollments/invite") && init?.method === "POST"
      ? ({ ok: true, status: 200, json: async () => ({ id: "ea-1", sent: false, ...body }) } as Response)
      : undefined;

  async function clickKirimFormulir(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Aisyah");
    await user.click(screen.getByRole("button", { name: /aksi|menu|lainnya/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Kirim Formulir" }));
  }

  it("a walk-in with only a phone gets the card: link, WhatsApp and fill-together, no email wording", async () => {
    serveRows(
      [baseRow({ parentPhone: "0812-3456-7890" })],
      invite({ formUrl: "https://talib.example/pendaftaran/tok-1", emailed: false, hasEmail: false }),
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirimFormulir(user);

    const dialog = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(dialog).getByText("Tidak ada email — bagikan lewat WhatsApp")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tautan formulir")).toHaveValue("https://talib.example/pendaftaran/tok-1");
    expect(within(dialog).getByRole("link", { name: "Kirim lewat WhatsApp (tab baru)" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/6281234567890?text="),
    );
    expect(within(dialog).getByRole("link", { name: "Isi bersama orang tua (tab baru)" })).toHaveAttribute(
      "href",
      "https://talib.example/pendaftaran/tok-1",
    );
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names the address when the email went out", async () => {
    serveRows(
      [baseRow({ parentEmail: "dewi@test.com", parentPhone: "0812-3456-7890" })],
      invite({ formUrl: "https://talib.example/pendaftaran/tok-1", sent: true, emailed: true, hasEmail: true }),
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirimFormulir(user);
    expect(await screen.findByText("Email terkirim ke dewi@test.com")).toBeInTheDocument();
  });

  it("an error from the server still shows as a toast, with no card", async () => {
    serveRows([baseRow()], (url, init) =>
      url.endsWith("/api/enrollments/invite") && init?.method === "POST"
        ? ({ ok: false, status: 409, json: async () => ({ message: "Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang." }) } as Response)
        : undefined,
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirimFormulir(user);
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang."),
    );
    expect(screen.queryByRole("dialog", { name: "Formulir siap dikirim" })).not.toBeInTheDocument();
  });

  it("a cancelled lead is not offered a formulir", async () => {
    serveRows([baseRow({ status: "CANCELLED" })]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    await user.click(screen.getByRole("button", { name: /aksi|menu|lainnya/i }));
    expect(screen.queryByRole("menuitem", { name: "Kirim Formulir" })).not.toBeInTheDocument();
  });
});
