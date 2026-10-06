/**
 * "Berkas" step of the public enrollment form: list, upload, replace/remove
 * and error mapping. Uploads hit the token-gated documents route directly and
 * are never part of the autosave payload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DocumentsStep, useDocumentUploads } from "../documents-step";
import { DOCUMENT_ITEMS, type PublicDocuments } from "@/lib/enrollment/documents";

vi.mock("@/lib/enrollment/compress-image", () => ({
  prepareUpload: async (f: File) => f,
}));

function Harness({ initial = {} }: { initial?: PublicDocuments }) {
  const docs = useDocumentUploads("tok-1", initial);
  return (
    <DocumentsStep
      documents={docs.documents}
      busy={docs.busy}
      errors={docs.errors}
      onUpload={docs.upload}
      onRemove={docs.remove}
    />
  );
}

function res(status: number, body: unknown = {}) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

const png = () => new File([new Uint8Array([1, 2, 3])], "kk.png", { type: "image/png" });

describe("DocumentsStep", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("lists every item with a required/optional hint and says uploads are optional", () => {
    render(<Harness />);
    expect(screen.getByText(/bersifat opsional/i)).toBeInTheDocument();
    for (const item of DOCUMENT_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Wajib")).toHaveLength(DOCUMENT_ITEMS.filter((i) => i.required).length);
    expect(screen.getAllByText("Opsional").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Nama berkas")).toBeInTheDocument();
  });

  it("uploads to the keyed route as multipart and shows the file name", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      res(201, { key: "kk", fileName: "kk.png", mimeType: "image/png", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z" }),
    );
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(screen.getByLabelText(/Kartu Keluarga/, { selector: "input" }), png());

    await waitFor(() => expect(screen.getByText(/kk\.png/)).toBeInTheDocument());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/enrollments/token/tok-1/documents?key=kk");
    expect((init as RequestInit).method).toBe("POST");
    const body = (init as RequestInit).body as FormData;
    expect((body.get("file") as File).name).toBe("kk.png");
    // once uploaded the row offers Ganti + Hapus
    expect(screen.getByRole("button", { name: "Ganti Kartu Keluarga (KK)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hapus Kartu Keluarga (KK)" })).toBeInTheDocument();
  });

  it("sends the custom label for 'lainnya'", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      res(201, { key: "lainnya", fileName: "x.png", mimeType: "image/png", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z", label: "Kartu imunisasi" }),
    );
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Nama berkas"), "Kartu imunisasi");
    await user.upload(screen.getByLabelText(/Berkas lainnya/, { selector: "input" }), png());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("label")).toBe("Kartu imunisasi");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/enrollments/token/tok-1/documents?key=lainnya");
  });

  it("maps a 413 to the size message and keeps the row empty", async () => {
    vi.mocked(fetch).mockImplementation(() => res(413));
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(screen.getByLabelText(/Kartu Keluarga/, { selector: "input" }), png());

    expect(
      await screen.findByText("Ukuran berkas terlalu besar (maks. 4 MB). Coba foto ulang atau kecilkan PDF."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ganti Kartu Keluarga (KK)" })).not.toBeInTheDocument();
  });

  it.each([
    [415, "Format tidak didukung. Gunakan foto (JPG/PNG) atau PDF."],
    [409, "Formulir sudah dikirim, berkas tidak bisa diubah."],
    [429, "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."],
    [500, "Gagal mengunggah. Periksa koneksi lalu coba lagi."],
  ])("maps %i to its message", async (status, message) => {
    vi.mocked(fetch).mockImplementation(() => res(status));
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText(/Kartu Keluarga/, { selector: "input" }), png());
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("deletes with DELETE on the same URL and clears the row", async () => {
    vi.mocked(fetch).mockImplementation(() => res(200, { ok: true }));
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ kk: { fileName: "kk.png", mimeType: "image/png", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z" } }}
      />,
    );
    expect(screen.getByText(/kk\.png/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hapus Kartu Keluarga (KK)" }));

    await waitFor(() => expect(screen.queryByText(/kk\.png/)).not.toBeInTheDocument());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/enrollments/token/tok-1/documents?key=kk");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("keeps the button mounted and focused while uploading, then restores the label", async () => {
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => (finish = r)));
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText(/Kartu Keluarga/, { selector: "input" });
    const btn = screen.getByRole("button", { name: "Unggah Kartu Keluarga (KK)" });
    await user.upload(input, png());

    const busy = await screen.findByRole("button", { name: "Mengunggah Kartu Keluarga (KK)" });
    expect(busy).toBe(btn);
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    btn.focus();
    expect(document.activeElement).toBe(btn);

    finish({ ok: true, status: 201, json: async () => ({ key: "kk", fileName: "kk.png", mimeType: "image/png", size: 3, uploadedAt: "x" }) } as Response);
    expect(await screen.findByRole("button", { name: "Ganti Kartu Keluarga (KK)" })).toBe(btn);
    expect(document.activeElement).toBe(btn);
  });

  it("moves focus to the row's Unggah button after a delete", async () => {
    vi.mocked(fetch).mockImplementation(() => res(200, { ok: true }));
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ kk: { fileName: "kk.png", mimeType: "image/png", size: 3, uploadedAt: "x" } }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Hapus Kartu Keluarga (KK)" }));
    const unggah = await screen.findByRole("button", { name: "Unggah Kartu Keluarga (KK)" });
    await waitFor(() => expect(document.activeElement).toBe(unggah));
  });

  it("does not drop a finished upload when another one finishes at the same time", async () => {
    const pending: Array<(r: Response) => void> = [];
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => pending.push(r)));
    const user = userEvent.setup();
    render(<Harness />);
    await user.upload(screen.getByLabelText(/Kartu Keluarga/, { selector: "input" }), png());
    await user.upload(screen.getByLabelText(/Akta kelahiran/, { selector: "input" }), new File(["a"], "akta.png", { type: "image/png" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    const body = (key: string, fileName: string) =>
      ({ ok: true, status: 201, json: async () => ({ key, fileName, mimeType: "image/png", size: 1, uploadedAt: "x" }) }) as Response;
    pending[1](body("akta", "akta.png"));
    pending[0](body("kk", "kk.png"));
    expect(await screen.findByText(/akta\.png/)).toBeInTheDocument();
    expect(await screen.findByText(/kk\.png/)).toBeInTheDocument();
  });

  it("keeps a row busy when the step unmounts and remounts mid-upload", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    const user = userEvent.setup();
    function Wizard() {
      const docs = useDocumentUploads("tok-1", {});
      const [show, setShow] = useState(true);
      return (
        <>
          <button onClick={() => setShow((v) => !v)}>toggle</button>
          {show && (
            <DocumentsStep documents={docs.documents} busy={docs.busy} errors={docs.errors} onUpload={docs.upload} onRemove={docs.remove} />
          )}
        </>
      );
    }
    render(<Wizard />);
    await user.upload(screen.getByLabelText(/Kartu Keluarga/, { selector: "input" }), png());
    await screen.findByRole("button", { name: "Mengunggah Kartu Keluarga (KK)" });
    await user.click(screen.getByText("toggle"));
    await user.click(screen.getByText("toggle"));
    expect(screen.getByRole("button", { name: "Mengunggah Kartu Keluarga (KK)" })).toBeInTheDocument();
  });
});
