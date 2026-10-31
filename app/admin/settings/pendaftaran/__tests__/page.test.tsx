import { MESSAGES } from "@/lib/feedback";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { DOCUMENT_ITEMS } from "@/lib/enrollment/documents";
import EnrollmentSettingsPage from "../page";

type Opts = {
  get?: { ok: boolean; status?: number; body?: unknown };
  put?: { ok: boolean; status: number; body: unknown };
};

function fixture({ get, put }: Opts = {}) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input !== "/api/config/enrollment") return { ok: true, status: 200, json: async () => ({}) };
    if (init?.method === "PUT") {
      const r = put ?? { ok: true, status: 200, body: JSON.parse(String(init.body)) };
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    const g = get ?? { ok: true, body: { requiredDocuments: ["kk"] } };
    return { ok: g.ok, status: g.status ?? (g.ok ? 200 : 500), json: async () => g.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const putCall = (fetchMock: ReturnType<typeof fixture>) =>
  fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");

describe("EnrollmentSettingsPage (berkas wajib pendaftaran)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders one checkbox per document with the saved ones checked", async () => {
    fixture();
    render(<EnrollmentSettingsPage />);

    expect(await screen.findByRole("heading", { name: "Pengaturan pendaftaran" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(DOCUMENT_ITEMS.length);
    expect(screen.getByRole("checkbox", { name: "Kartu Keluarga (KK)" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "KTP Ayah" })).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(/Berkas yang dicentang wajib diunggah orang tua sebelum formulir bisa dikirim/),
    ).toBeInTheDocument();
    // Item notes are shown next to the label.
    expect(screen.getByText("Bawa juga 4 lembar cetak ke sekolah")).toBeInTheDocument();
  });

  it("renders read-only up front when the API says canEdit is false", async () => {
    const fetchMock = fixture({ get: { ok: true, body: { requiredDocuments: ["kk"], canEdit: false } } });
    render(<EnrollmentSettingsPage />);

    expect(await screen.findByText(/Anda hanya bisa melihat pengaturan ini/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Kartu Keluarga (KK)" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.queryByRole("button", { name: "Simpan Pengaturan" })).not.toBeInTheDocument();
    expect(putCall(fetchMock)).toBeUndefined();
  });

  it("shows a no-access message, not a retry, when the GET is forbidden", async () => {
    fixture({ get: { ok: false, status: 403, body: { error: "Forbidden" } } });
    render(<EnrollmentSettingsPage />);

    expect(await screen.findByText("Anda tidak memiliki akses ke pengaturan ini.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument();
    expect(screen.queryByText("Gagal memuat pengaturan.")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("keeps Simpan disabled until something changes, then PUTs the selected keys", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<EnrollmentSettingsPage />);

    const save = await screen.findByRole("button", { name: "Simpan Pengaturan" });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "KTP Ayah" }));
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(putCall(fetchMock)).toBeTruthy());
    const [, init] = putCall(fetchMock)!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      requiredDocuments: ["kk", "ktp_ayah"],
      programFees: [],
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pengaturan disimpan."));
    // Saved state is the new baseline.
    expect(screen.getByRole("button", { name: "Simpan Pengaturan" })).toBeDisabled();
  });

  it("locks the controls and explains why when the PUT is forbidden", async () => {
    fixture({ put: { ok: false, status: 403, body: { error: "Forbidden" } } });
    const user = userEvent.setup();
    render(<EnrollmentSettingsPage />);

    await user.click(await screen.findByRole("checkbox", { name: "KTP Ayah" }));
    await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

    expect(await screen.findByText(/Anda hanya bisa melihat pengaturan ini/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "KTP Ayah" })).toHaveAttribute("aria-disabled", "true");
    // Unsaved edit rolled back to what is actually stored.
    expect(screen.getByRole("checkbox", { name: "KTP Ayah" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("button", { name: "Simpan Pengaturan" })).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Anda tidak memiliki akses untuk mengubah pengaturan ini.");
  });

  it("shows a plain Indonesian error and keeps the edit when saving fails", async () => {
    fixture({ put: { ok: false, status: 500, body: {} } });
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<EnrollmentSettingsPage />);

    await user.click(await screen.findByRole("checkbox", { name: "KTP Ayah" }));
    await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(MESSAGES.saveFailed));
    // Rendered in the form too (FormRootError), not only as a toast.
    expect(screen.getByRole("alert")).toHaveTextContent(MESSAGES.saveFailed);
    expect(screen.getByRole("checkbox", { name: "KTP Ayah" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Simpan Pengaturan" })).toBeEnabled();
  });

  it("puts a validation 400 on the checkbox group", async () => {
    fixture({
      put: {
        ok: false,
        status: 400,
        body: {
          error: "Validasi gagal",
          errors: [{ field: "requiredDocuments", message: "Jenis berkas tidak dikenal" }],
        },
      },
    });
    const user = userEvent.setup();
    render(<EnrollmentSettingsPage />);

    await user.click(await screen.findByRole("checkbox", { name: "KTP Ayah" }));
    await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

    expect(await screen.findByText("Jenis berkas tidak dikenal")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Gagal menyimpan. Periksa kolom yang ditandai.");
    const group = screen.getByRole("group", { name: "Wajib diunggah sebelum formulir dikirim" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(toast.success).not.toHaveBeenCalled();
  });

  describe("biaya pendaftaran per program", () => {
    const programs = [
      { id: "p-kb", code: "KB", name: "Kelompok Bermain", enrollmentFee: 300000 },
      { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: 375000 },
    ];
    const withPrograms = (extra: Record<string, unknown> = {}) => ({
      ok: true,
      body: { requiredDocuments: [], programs, ...extra },
    });

    it("shows one rupiah input per active program with the saved fee", async () => {
      fixture({ get: withPrograms() });
      render(<EnrollmentSettingsPage />);

      expect(await screen.findByRole("group", { name: "Biaya pendaftaran per program" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Biaya pendaftaran Kelompok Bermain" })).toHaveValue("300.000");
      expect(screen.getByRole("textbox", { name: "Biaya pendaftaran Day Care" })).toHaveValue("375.000");
    });

    it("PUTs the edited fee as whole rupiah next to the documents", async () => {
      const fetchMock = fixture({ get: withPrograms() });
      const user = userEvent.setup();
      render(<EnrollmentSettingsPage />);

      const input = await screen.findByRole("textbox", { name: "Biaya pendaftaran Kelompok Bermain" });
      await user.clear(input);
      await user.type(input, "350000");
      await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

      await waitFor(() => expect(putCall(fetchMock)).toBeTruthy());
      const body = JSON.parse(String((putCall(fetchMock)![1] as RequestInit).body));
      expect(body).toEqual({
        requiredDocuments: [],
        programFees: [
          { programId: "p-kb", fee: 350000 },
          { programId: "p-dc", fee: 375000 },
        ],
      });
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pengaturan disimpan."));
    });

    it("an emptied input is saved as 0, meaning no payment step", async () => {
      const fetchMock = fixture({ get: withPrograms() });
      const user = userEvent.setup();
      render(<EnrollmentSettingsPage />);

      await user.clear(await screen.findByRole("textbox", { name: "Biaya pendaftaran Day Care" }));
      await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

      await waitFor(() => expect(putCall(fetchMock)).toBeTruthy());
      const body = JSON.parse(String((putCall(fetchMock)![1] as RequestInit).body));
      expect(body.programFees).toContainEqual({ programId: "p-dc", fee: 0 });
    });

    it("locks the fee inputs for a read-only viewer", async () => {
      fixture({ get: withPrograms({ canEdit: false }) });
      render(<EnrollmentSettingsPage />);

      expect(await screen.findByRole("textbox", { name: "Biaya pendaftaran Kelompok Bermain" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: "Biaya pendaftaran Day Care" })).toBeDisabled();
    });

    it("says so when the school has no active program yet", async () => {
      fixture({ get: withPrograms({ programs: [] }) });
      render(<EnrollmentSettingsPage />);

      expect(await screen.findByText(/Belum ada program aktif/)).toBeInTheDocument();
    });

    it("shows the server's per-row fee error under that row's input (the path the server really emits)", async () => {
      fixture({
        get: withPrograms(),
        put: {
          ok: false,
          status: 400,
          body: {
            error: "Validasi gagal",
            errors: [{ field: "programFees.1.fee", message: "Biaya pendaftaran terlalu besar" }],
          },
        },
      });
      const user = userEvent.setup();
      render(<EnrollmentSettingsPage />);

      const input = await screen.findByRole("textbox", { name: "Biaya pendaftaran Day Care" });
      await user.clear(input);
      await user.type(input, "1");
      await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

      const message = await screen.findByText("Biaya pendaftaran terlalu besar");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input.getAttribute("aria-describedby")).toBe(message.id);
      // The other row is untouched.
      expect(screen.getByRole("textbox", { name: "Biaya pendaftaran Kelompok Bermain" })).not.toHaveAttribute("aria-invalid");
    });

    it("blocks an over-limit fee on the client with visible text and no request", async () => {
      const fetchMock = fixture({ get: withPrograms() });
      const user = userEvent.setup();
      render(<EnrollmentSettingsPage />);

      const input = await screen.findByRole("textbox", { name: "Biaya pendaftaran Kelompok Bermain" });
      await user.clear(input);
      await user.type(input, "150000000");
      await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

      expect(await screen.findByText("Biaya pendaftaran terlalu besar")).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(putCall(fetchMock)).toBeUndefined();
    });

    it("tells the admin to reload when the program list changed under them (422)", async () => {
      fixture({
        get: withPrograms(),
        put: { ok: false, status: 422, body: { error: "Daftar program berubah. Muat ulang halaman lalu coba lagi." } },
      });
      const user = userEvent.setup();
      render(<EnrollmentSettingsPage />);

      const input = await screen.findByRole("textbox", { name: "Biaya pendaftaran Day Care" });
      await user.clear(input);
      await user.type(input, "1");
      await user.click(screen.getByRole("button", { name: "Simpan Pengaturan" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Daftar program berubah. Muat ulang halaman lalu coba lagi.");
    });
  });

  it("offers a retry when the settings cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fixture({ get: { ok: false, body: {} } });
    render(<EnrollmentSettingsPage />);

    expect(await screen.findByText("Gagal memuat pengaturan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
