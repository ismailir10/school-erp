/**
 * Kelengkapan Berkas card on the admin enrollment detail page.
 * Covers status badges, the "x / 9" progress, the edit gate on the
 * "Diterima fisik" tick and the PATCH body it sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EnrollmentDocumentsCard } from "../enrollment-documents-card";
import type { AdminDocuments } from "@/lib/enrollment/documents";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));

const docs: AdminDocuments = {
  akta: {
    hasFile: true,
    fileName: "akta.jpg",
    mimeType: "image/jpeg",
    size: 1000,
    uploadedAt: "2026-10-06T00:00:00.000Z",
    receivedPhysical: false,
    receivedAt: null,
  },
  kk: {
    hasFile: false,
    fileName: null,
    mimeType: null,
    size: null,
    uploadedAt: null,
    receivedPhysical: true,
    receivedAt: "2026-10-06T00:00:00.000Z",
  },
  lainnya: {
    hasFile: true,
    fileName: "imunisasi.pdf",
    mimeType: "application/pdf",
    size: 2000,
    uploadedAt: "2026-10-06T00:00:00.000Z",
    label: "Kartu imunisasi",
    receivedPhysical: false,
    receivedAt: null,
  },
};

function jsonResponse(ok: boolean, body: unknown = {}, status = ok ? 200 : 500) {
  return Promise.resolve({ ok, status, json: async () => body } as Response);
}

describe("EnrollmentDocumentsCard", () => {
  beforeEach(() => {
    toastError.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(true, { ok: true })));
  });

  it("shows progress, statuses and a view link for uploaded files", () => {
    render(<EnrollmentDocumentsCard applicationId="ea-1" documents={docs} canEdit />);

    expect(screen.getByText("Kelengkapan Berkas")).toBeInTheDocument();
    // akta uploaded + kk received physically = 2 of 9 required
    expect(screen.getByText("2 / 9 berkas lengkap")).toBeInTheDocument();
    expect(screen.getAllByText("Diunggah")).toHaveLength(2);
    expect(screen.getByText("Diterima fisik", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.getAllByText("Belum").length).toBeGreaterThan(0);

    const link = screen.getByRole("link", { name: "Lihat Akta kelahiran anak" });
    expect(link).toHaveAttribute("href", "/api/enrollments/ea-1/documents/akta");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.queryByRole("link", { name: "Lihat KTP Ayah" })).not.toBeInTheDocument();

    // optional items are marked, and the custom label for "lainnya" shows
    expect(screen.getAllByText("Opsional")).toHaveLength(2);
    expect(screen.getByText("Berkas lainnya: Kartu imunisasi")).toBeInTheDocument();
  });

  it("does not count optional items toward the total", () => {
    render(
      <EnrollmentDocumentsCard
        applicationId="ea-1"
        documents={{ lainnya: docs.lainnya }}
        canEdit
      />,
    );
    expect(screen.getByText("0 / 9 berkas lengkap")).toBeInTheDocument();
  });

  it("disables the tick without edit permission", () => {
    render(<EnrollmentDocumentsCard applicationId="ea-1" documents={docs} canEdit={false} />);
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("PATCHes documentsReceived on toggle and updates optimistically", async () => {
    const user = userEvent.setup();
    render(<EnrollmentDocumentsCard applicationId="ea-1" documents={docs} canEdit />);

    await user.click(screen.getByRole("checkbox", { name: "Diterima fisik: KTP Ayah" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/enrollments/ea-1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      documentsReceived: { ktp_ayah: true },
    });
    expect(await screen.findByText("3 / 9 berkas lengkap")).toBeInTheDocument();
  });

  it("reverts the tick and shows a generic message when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(false, { error: "INTERNAL_ERROR_CODE" }, 500)));
    const user = userEvent.setup();
    render(<EnrollmentDocumentsCard applicationId="ea-1" documents={docs} canEdit />);

    await user.click(screen.getByRole("checkbox", { name: "Diterima fisik: KTP Ayah" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Gagal menyimpan. Coba lagi."));
    expect(screen.getByText("2 / 9 berkas lengkap")).toBeInTheDocument();
  });

  it("maps a 403 to a permission message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(false, { error: "FORBIDDEN" }, 403)));
    const user = userEvent.setup();
    render(<EnrollmentDocumentsCard applicationId="ea-1" documents={docs} canEdit />);

    await user.click(screen.getByRole("checkbox", { name: "Diterima fisik: KTP Ayah" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Anda tidak memiliki akses untuk mengubah berkas."),
    );
  });
});
