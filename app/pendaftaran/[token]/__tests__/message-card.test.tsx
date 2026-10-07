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
