/**
 * Public enrollment form — signature handover note, the Berkas step wiring and
 * the autosave stale-closure fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({
    label,
    saved,
    saving,
    onSave,
  }: {
    label: string;
    saved: boolean;
    saving?: boolean;
    onSave: (b: Blob) => void;
  }) => (
    <div>
      {`${label}: ${saved ? "tersimpan" : "kosong"}`}
      <button type="button" aria-busy={saving} onClick={() => onSave(new Blob(["x"], { type: "image/png" }))}>
        {saving ? `Menyimpan ${label}` : `Simpan ${label}`}
      </button>
    </div>
  ),
}));

const programs = [{ id: "p-1", name: "TK A" }];

const filled = {
  programId: "p-1",
  dcareAddon: false,
  studentData: {
    childName: "Aisyah",
    childGender: "P",
    birthPlace: "Bogor",
    dateOfBirth: "2021-01-01",
    agama: "ISLAM",
    kewarganegaraan: "WNI",
  },
  ayahData: { name: "Budi" },
  ibuData: { name: "Siti" },
  consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: false } },
  documents: {},
};

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

async function gotoConsent(user: ReturnType<typeof userEvent.setup>) {
  // Data Anak -> Ayah -> Ibu -> Program -> Berkas -> Persetujuan
  for (let i = 0; i < 5; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
}

describe("PendaftaranClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("has the Berkas step between Program and Persetujuan", () => {
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    const labels = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(labels).toEqual([
      "1. Data Anak",
      "2. Data Ayah",
      "3. Data Ibu",
      "4. Program",
      "5. Berkas",
      "6. Persetujuan",
      "7. Tinjau",
    ]);
  });

  it("blocks Lanjut on Berkas until every school-required document is uploaded", async () => {
    const user = userEvent.setup();
    render(
      <PendaftaranClient
        token="tok"
        programs={programs}
        prefill={filled}
        requiredDocuments={["kk", "ktp_ayah"]}
      />,
    );
    // Data Anak -> Ayah -> Ibu -> Program -> Berkas
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.getAllByText("Wajib diunggah")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.getByText("Kartu Keluarga (KK) wajib diunggah.")).toBeInTheDocument();
    expect(screen.getByText("KTP Ayah wajib diunggah.")).toBeInTheDocument();
    // Still on Berkas, not Persetujuan.
    expect(screen.getByText("Berkas pendukung")).toBeInTheDocument();
  });

  it("lets Lanjut through on Berkas once required documents are present", async () => {
    const user = userEvent.setup();
    const file = { fileName: "x.png", mimeType: "image/png", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z" };
    render(
      <PendaftaranClient
        token="tok"
        programs={programs}
        prefill={{ ...filled, documents: { kk: file, ktp_ayah: file } }}
        requiredDocuments={["kk", "ktp_ayah"]}
      />,
    );
    await gotoConsent(user);
    expect(screen.getByText("Tanda tangan Ayah: tersimpan")).toBeInTheDocument();
  });

  it("keeps Berkas optional when the school requires nothing", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);
    expect(screen.getByText("Tanda tangan Ayah: tersimpan")).toBeInTheDocument();
  });

  it("shows a handover note when only one parent has signed, without blocking Lanjut copy", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    expect(screen.getByText("Tanda tangan Ibu belum ada")).toBeInTheDocument();
    expect(screen.getByText("Tanda tangan Ayah: tersimpan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salin link/ })).toBeInTheDocument();

    // Lanjut still requires both signatures.
    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.getByText("Tanda tangan ibu wajib disimpan.")).toBeInTheDocument();
  });

  it("'Periksa lagi' re-reads signature status and clears the note once both exist", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature") ? ok({ ayah: true, ibu: true }) : ok({}),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    await waitFor(() => expect(screen.queryByText("Tanda tangan Ibu belum ada")).not.toBeInTheDocument());
    expect(screen.getByText("Tanda tangan Ibu: tersimpan")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === "/api/enrollments/token/tok/signature")).toBe(true);
  });

  it("says so when nothing changed", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature") ? ok({ ayah: true, ibu: false }) : ok({}),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    expect(await screen.findByText("Belum ada tanda tangan baru.")).toBeInTheDocument();
  });

  it("autosave sends the latest typed value and never signature tokens", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);

    const name = screen.getByLabelText(/^Nama lengkap/);
    await user.clear(name);
    await user.type(name, "Zahra");

    await waitFor(
      () => {
        const patches = vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
        expect(patches).toHaveLength(1);
      },
      { timeout: 4000 },
    );
    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")!;
    const body = JSON.parse((patch[1] as RequestInit).body as string);
    expect(body.studentData.childName).toBe("Zahra");
    expect(body.consentData.ayah).toEqual({ name: "Budi" });
    expect(JSON.stringify(body)).not.toMatch(/signatureToken/);
  });

  it("flushes a pending autosave with keepalive when the page is hidden", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);

    const name = screen.getByLabelText(/^Nama lengkap/);
    await user.clear(name);
    await user.type(name, "Zahra");
    fireEvent(window, new Event("pagehide"));

    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")!;
    expect(patch).toBeTruthy();
    expect((patch[1] as RequestInit).keepalive).toBe(true);
    expect(JSON.parse((patch[1] as RequestInit).body as string).studentData.childName).toBe("Zahra");
  });

  it("fills an empty name from the server but never overwrites a typed one", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature")
        ? ok({ ayah: true, ibu: false, ayahName: "Nama Server", ibuName: "Siti Server" })
        : ok({}),
    );
    const user = userEvent.setup();
    const prefill = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "", signed: false } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={prefill} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    expect(await screen.findByText("Tanda tangan terbaru sudah dimuat.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nama jelas Ibu/)).toHaveValue("Siti Server");
    expect(screen.getByLabelText(/^Nama jelas Ayah/)).toHaveValue("Budi");
  });

  it("moves focus to the live status line when the note unmounts after 'Periksa lagi'", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature") ? ok({ ayah: true, ibu: true }) : ok({}),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    const status = await screen.findByText("Tanda tangan terbaru sudah dimuat.");
    expect(document.activeElement).toBe(status);
  });

  it("keeps the latest edits in the draft when submit fails", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/submit") ? Promise.reject(new Error("offline")) : ok({}),
    );
    const user = userEvent.setup();
    const both = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={both} />);
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    vi.mocked(fetch).mockClear();

    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));

    await waitFor(
      () => expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(true),
      { timeout: 4000 },
    );
  });

  it("blocks Kirim while an upload is in flight and explains why on Tinjau", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes("/documents") ? new Promise<Response>(() => undefined) : ok({}),
    );
    const user = userEvent.setup();
    const both = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={both} />);
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    await user.upload(
      screen.getByLabelText(/Kartu Keluarga/, { selector: "input" }),
      new File(["%PDF-1.4"], "kk.pdf", { type: "application/pdf" }),
    );
    await screen.findByRole("button", { name: "Mengunggah Kartu Keluarga (KK)" });
    for (let i = 0; i < 2; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));

    expect(screen.getByText("Masih ada berkas yang sedang diunggah. Mohon tunggu sebentar.")).toBeInTheDocument();
    expect(screen.getByText("Sedang diunggah").nextSibling).toHaveTextContent("1");
    const kirim = screen.getByRole("button", { name: "Menunggu unggahan selesai…" });
    expect(kirim).toHaveAttribute("aria-disabled", "true");
    expect(kirim).toHaveAttribute("aria-busy", "true");

    await user.click(kirim);
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith("/submit"))).toBe(false);
  });

  it("shows the birth date on Tinjau as a readable date, not raw ISO", async () => {
    const user = userEvent.setup();
    const both = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={both} />);
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));

    expect(await screen.findByText("Bogor, 1 Jan 2021")).toBeInTheDocument();
    expect(screen.queryByText(/2021-01-01/)).not.toBeInTheDocument();
  });

  it("puts the handover note above the signature pads", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);
    const note = screen.getByText("Tanda tangan Ibu belum ada");
    const pad = screen.getByText("Tanda tangan Ibu: kosong");
    expect(note.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("blocks Lanjut and Kirim while a signature save is in flight", async () => {
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes("/signature?which=")
        ? new Promise<Response>((r) => (finish = r))
        : ok({}),
    );
    const user = userEvent.setup();
    const both = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={both} />);
    await gotoConsent(user);

    // redraw + save Ayah's signature, POST stays pending
    await user.click(screen.getByRole("button", { name: "Simpan Tanda tangan Ayah" }));
    const lanjut = await screen.findByRole("button", { name: "Menyimpan tanda tangan…" });
    expect(lanjut).toHaveAttribute("aria-disabled", "true");
    expect(lanjut).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Menyimpan Tanda tangan Ayah" })).toBeInTheDocument();

    // Lanjut does nothing: still on Persetujuan
    await user.click(lanjut);
    expect(screen.getByText("Surat Persetujuan Orang Tua")).toBeInTheDocument();

    finish({ ok: true, status: 200, json: async () => ({ saved: true }) } as Response);
    const next = await screen.findByRole("button", { name: "Lanjut" });
    expect(next).toHaveAttribute("aria-disabled", "false");
    await user.click(next);
    expect(await screen.findByText("Tinjau & Kirim")).toBeInTheDocument();
  });

  describe("server rejects a required document that this tab still shows", () => {
    const file = { fileName: "akta.pdf", mimeType: "application/pdf", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z" };
    const signed = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
      documents: { akta: file },
    };

    function rejectAkta(extra?: (input: RequestInfo | URL) => Promise<Response> | undefined) {
      vi.mocked(fetch).mockImplementation((input) => {
        const custom = extra?.(input);
        if (custom) return custom;
        if (String(input).endsWith("/submit")) {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({
              error: "validation_failed",
              fields: { documents: "Berkas wajib belum diunggah: Akta kelahiran anak" },
              missingDocuments: ["akta"],
            }),
          } as Response);
        }
        return ok({});
      });
    }

    async function submitFromTinjau(user: ReturnType<typeof userEvent.setup>) {
      render(<PendaftaranClient token="tok" programs={programs} prefill={signed} requiredDocuments={["akta"]} />);
      for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
      await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
    }

    it("422 with missingDocuments jumps to Berkas and resets those rows", async () => {
      rejectAkta();
      const user = userEvent.setup();
      await submitFromTinjau(user);

      expect(await screen.findByText("Berkas pendukung")).toBeInTheDocument();
      expect(screen.getByText("Akta kelahiran anak wajib diunggah.")).toBeInTheDocument();
      expect(screen.queryByText("akta.pdf", { exact: false })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unggah Akta kelahiran anak" })).toBeInTheDocument();
      const row = screen.getByText("Akta kelahiran anak", { selector: "p" }).closest("li") as HTMLElement;
      expect(within(row).getByText("Belum diunggah")).toBeInTheDocument();
    });

    it("the Berkas error disappears once the missing file is uploaded", async () => {
      rejectAkta((input) =>
        String(input).includes("/documents?key=akta")
          ? ok({ key: "akta", fileName: "baru.pdf", mimeType: "application/pdf", size: 8, uploadedAt: "2026-10-07T00:00:00.000Z" })
          : undefined,
      );
      const user = userEvent.setup();
      await submitFromTinjau(user);
      await screen.findByText("Akta kelahiran anak wajib diunggah.");

      await user.upload(
        screen.getByLabelText(/Akta kelahiran anak/, { selector: "input" }),
        new File(["%PDF-1.4"], "baru.pdf", { type: "application/pdf" }),
      );

      await waitFor(() => expect(screen.queryByText("Akta kelahiran anak wajib diunggah.")).not.toBeInTheDocument());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText("baru.pdf", { exact: false })).toBeInTheDocument();
    });

    it("keeps a server-rejected key required, so Lanjut stays blocked, even if the page's own list omitted it", async () => {
      rejectAkta();
      const user = userEvent.setup();
      render(<PendaftaranClient token="tok" programs={programs} prefill={signed} />);
      for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
      await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
      await screen.findByText("Akta kelahiran anak wajib diunggah.");

      await user.click(screen.getByRole("button", { name: "Lanjut" }));
      // Still on Berkas, not Persetujuan.
      expect(screen.getByText("Berkas pendukung")).toBeInTheDocument();
      expect(screen.getByText("Akta kelahiran anak wajib diunggah.")).toBeInTheDocument();
    });
  });

});
