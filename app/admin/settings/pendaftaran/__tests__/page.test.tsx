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

    expect(await screen.findByRole("heading", { name: "Berkas wajib pendaftaran" })).toBeInTheDocument();
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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gagal menyimpan. Coba lagi."));
    expect(screen.getByRole("checkbox", { name: "KTP Ayah" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Simpan Pengaturan" })).toBeEnabled();
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
