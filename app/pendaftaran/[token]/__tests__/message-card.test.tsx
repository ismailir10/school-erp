/**
 * Expired / invalid link pages: school contact when configured, text only when not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const resolveEnrollmentToken = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { program: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/enrollment/resolve-token", () => ({
  resolveEnrollmentToken: (...a: unknown[]) => resolveEnrollmentToken(...a),
}));
vi.mock("@/lib/enrollment/required-documents", () => ({ getRequiredDocuments: vi.fn(async () => []) }));
vi.mock("../client", () => ({ default: () => <div>form</div> }));

import PendaftaranTokenPage from "../page";
import { MessageCard } from "../message-card";
import { SCHOOL_CONTACT_FALLBACK_TEXT } from "@/lib/contact";

async function renderPage(access: "EXPIRED" | "NOT_FOUND") {
  resolveEnrollmentToken.mockResolvedValue({ access, application: null, tenantId: undefined });
  render(await PendaftaranTokenPage({ params: Promise.resolve({ token: "tok" }) }));
}

describe("expired / invalid enrollment link", () => {
  beforeEach(() => {
    vi.stubEnv("SCHOOL_CONTACT_PHONE", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows WhatsApp and call links on the expired page when the school phone is set", async () => {
    vi.stubEnv("SCHOOL_CONTACT_PHONE", "0812-8877-4402");
    await renderPage("EXPIRED");

    expect(screen.getByRole("heading", { name: "Tautan sudah kedaluwarsa" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chat WhatsApp/ })).toHaveAttribute("href", "https://wa.me/6281288774402");
    expect(screen.getByRole("link", { name: /Telepon sekolah/ })).toHaveAttribute("href", "tel:081288774402");
  });

  it("shows the same links on the not-found page", async () => {
    vi.stubEnv("SCHOOL_CONTACT_PHONE", "+62 812 8877 4402");
    await renderPage("NOT_FOUND");
    expect(screen.getByRole("link", { name: /Chat WhatsApp/ })).toHaveAttribute("href", "https://wa.me/6281288774402");
  });

  it("keeps the text-only message when no phone is configured", async () => {
    await renderPage("EXPIRED");
    expect(screen.getByText(/Mohon hubungi tim penerimaan/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("MessageCard renders no links for an unusable number", () => {
    render(<MessageCard title="T" body="B" phone="12" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("already-submitted page keeps the bring-to-school checklist (R2-P-15)", () => {
  const file = { fileToken: "t", fileName: "a.pdf", mimeType: "application/pdf", size: 3, uploadedAt: "2026-10-06T00:00:00.000Z" };

  async function renderSubmitted(documents: unknown, consentData: unknown = {}) {
    resolveEnrollmentToken.mockResolvedValue({
      access: "SUBMITTED",
      tenantId: "t-1",
      application: { documents, consentData },
    });
    render(await PendaftaranTokenPage({ params: Promise.resolve({ token: "tok" }) }));
  }

  it("lists the required documents that are still missing", async () => {
    await renderSubmitted({ akta: file, kk: file });
    expect(screen.getByRole("heading", { name: "Formulir sudah diterima" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Berkas yang perlu dibawa ke sekolah" })).toBeInTheDocument();
    expect(screen.queryByText("Akta kelahiran anak")).not.toBeInTheDocument();
    expect(screen.getByText("Kartu Identitas Anak (KIA)")).toBeInTheDocument();
    expect(screen.getByText("KTP Ayah")).toBeInTheDocument();
  });

  it("leaves out the waived parent's documents for a single-parent family", async () => {
    await renderSubmitted({}, { onlyParent: "ibu" });
    expect(screen.queryByText("KTP Ayah")).not.toBeInTheDocument();
    expect(screen.queryByText("Pas foto berwarna Ayah 3×4")).not.toBeInTheDocument();
    expect(screen.getByText("KTP Ibu")).toBeInTheDocument();
  });

  it("shows no checklist once everything is in (uploaded or marked received)", async () => {
    const all = Object.fromEntries(
      ["akta", "kk", "kia", "ktp_ayah", "ktp_ibu", "foto_anak", "foto_ayah", "foto_ibu", "surat_sehat"].map((k) => [k, file]),
    );
    await renderSubmitted(all);
    expect(screen.getByRole("heading", { name: "Formulir sudah diterima" })).toBeInTheDocument();
    expect(screen.queryByText("Berkas yang perlu dibawa ke sekolah")).not.toBeInTheDocument();
  });
});

describe("MessageCard contact fallback (R2-P-11)", () => {
  it("tells the parent where to go when no school number is configured", () => {
    render(<MessageCard title="Tautan sudah kedaluwarsa" body="Hubungi tim penerimaan." phone={null} />);
    expect(screen.getByText(SCHOOL_CONTACT_FALLBACK_TEXT)).toBeInTheDocument();
  });

  it("adds no contact line to a card that needs no follow-up", () => {
    render(<MessageCard title="Formulir sudah diterima" body="Terima kasih." />);
    expect(screen.queryByText(SCHOOL_CONTACT_FALLBACK_TEXT)).toBeNull();
  });
});
