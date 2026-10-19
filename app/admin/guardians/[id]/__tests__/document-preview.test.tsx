/**
 * Dokumen on demand: a KTP/KK is personal data, so nothing is requested until
 * the admin clicks "Lihat". Upload keeps its validation and toasts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import GuardianDetailPage from "../page";
import { CLEAN_SUMMARY, fulfilledParams, makeParent, okJson } from "./parent-fixture";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const PARENT = makeParent({
  hasKtp: true,
  hasKk: false,
  guardians: [],
  invoices: [],
  unpaidInvoices: [],
  invoiceSummary: CLEAN_SUMMARY,
});

const embeds = () => Array.from(document.querySelectorAll("embed"));
const postCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

async function renderOpen(parent = PARENT) {
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method && init.method !== "GET" ? okJson({ success: true }) : okJson(parent),
    ),
  );
  const user = userEvent.setup({ applyAccept: false });
  render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  await screen.findByRole("heading", { name: "Ibu Siti Aminah" });
  const documents = document.getElementById("documents")!;
  await user.click(documents.querySelector('[data-slot="collapsible-trigger"]') as HTMLElement);
  await screen.findByRole("group", { name: "KTP" });
  return { user, ktp: screen.getByRole("group", { name: "KTP" }), kk: screen.getByRole("group", { name: "KK" }) };
}

describe("guardian page — documents on request", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("renders no preview and requests no file until Lihat is clicked", async () => {
    const { user, ktp } = await renderOpen();

    expect(embeds()).toHaveLength(0);
    expect(within(ktp).getByText("Ada")).toBeInTheDocument();
    // The only requests so far are the page's own JSON, never the document.
    expect(vi.mocked(fetch).mock.calls.every(([u]) => !String(u).endsWith("/ktp"))).toBe(true);

    await user.click(within(ktp).getByRole("button", { name: /^Lihat/ }));

    expect(embeds()).toHaveLength(1);
    expect(embeds()[0]).toHaveAttribute("src", "/api/parents/p1/ktp?v=0");
    expect(within(ktp).getByRole("link", { name: "Buka di tab baru →" })).toHaveAttribute(
      "href",
      "/api/parents/p1/ktp?v=0",
    );
  });

  it("closes the preview again", async () => {
    const { user, ktp } = await renderOpen();
    await user.click(within(ktp).getByRole("button", { name: /^Lihat/ }));
    expect(embeds()).toHaveLength(1);

    await user.click(within(ktp).getByRole("button", { name: /^Tutup/ }));
    expect(embeds()).toHaveLength(0);
  });

  it("an absent file offers only Unggah: no Lihat, no Hapus, no preview", async () => {
    const { kk } = await renderOpen();
    expect(within(kk).getByText("Belum ada")).toBeInTheDocument();
    expect(within(kk).getByRole("button", { name: "Unggah KK" })).toBeInTheDocument();
    expect(within(kk).queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();
    expect(within(kk).queryByRole("button", { name: /^Hapus/ })).not.toBeInTheDocument();
  });

  it("a viewer who cannot edit can look but not change", async () => {
    const { ktp } = await renderOpen({ ...PARENT, canEdit: false });
    expect(within(ktp).getByRole("button", { name: /^Lihat/ })).toBeInTheDocument();
    expect(within(ktp).queryByRole("button", { name: /^Hapus/ })).not.toBeInTheDocument();
    expect(within(ktp).queryByRole("button", { name: /Ganti KTP/ })).not.toBeInTheDocument();
  });

  it("uploads a valid file, toasts, and reloads the page data", async () => {
    const { user, kk } = await renderOpen();
    const input = kk.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.4"], "kk.pdf", { type: "application/pdf" });

    await user.upload(input, file);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(String(postCalls()[0][0])).toBe("/api/parents/p1/kk");
    expect((postCalls()[0][1] as RequestInit).body).toBeInstanceOf(FormData);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("KK diperbarui"));
  });

  it("rejects a wrong format and an oversize file before any request", async () => {
    const { user, kk } = await renderOpen();
    const input = kk.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(["x"], "kk.txt", { type: "text/plain" }));
    expect(toast.error).toHaveBeenCalledWith("Format KK harus JPG, PNG, atau PDF");

    const big = new File(["x"], "kk.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    await user.upload(input, big);
    expect(toast.error).toHaveBeenCalledWith("Ukuran KK maksimal 5 MB");

    expect(postCalls()).toHaveLength(0);
  });

  it("deleting an open preview closes it", async () => {
    const { user, ktp } = await renderOpen();
    await user.click(within(ktp).getByRole("button", { name: /^Lihat/ }));
    expect(embeds()).toHaveLength(1);

    await user.click(within(ktp).getByRole("button", { name: /^Hapus/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Ya, Hapus" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("KTP dihapus"));
    expect(embeds()).toHaveLength(0);
  });
});
