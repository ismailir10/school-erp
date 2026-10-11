/**
 * /pendaftaran/[token]/pembayaran — where DOKU sends the parent back, and where
 * the form link leads someone checking on a payment. It must not trust the
 * redirect: it asks the gateway (throttled) and then shows the stored state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { resolveToken, getFee, reconcile, feeFindUnique, refresh } = vi.hoisted(() => ({
  resolveToken: vi.fn(),
  getFee: vi.fn(),
  reconcile: vi.fn(),
  feeFindUnique: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/db", () => ({ prisma: { enrollmentFee: { findUnique: feeFindUnique } } }));
vi.mock("@/lib/enrollment/resolve-token", () => ({ resolveEnrollmentToken: resolveToken }));
vi.mock("@/lib/enrollment/fee-view", () => ({ getPublicFeeView: getFee }));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileEnrollmentFee: reconcile }));
vi.mock("@/lib/contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contact")>()),
  schoolContactPhone: () => null,
}));
vi.mock("@/components/brand/talib-wordmark", () => ({ TalibWordmark: () => null }));

import PembayaranPage, { metadata } from "../page";

const TOKEN = "a".repeat(43);
const app = (over: Record<string, unknown> = {}) => ({ id: "app-1", childName: "Aisyah", status: "SUBMITTED", ...over });
const fee = (over: Record<string, unknown> = {}) => ({
  amount: 300_000,
  baseAmount: 300_000,
  discountPercent: 0,
  status: "UNPAID",
  paidAt: null,
  started: true,
  ...over,
});

async function renderPage(opts: { token?: string; status?: string } = {}) {
  const ui = await PembayaranPage({
    params: Promise.resolve({ token: opts.token ?? TOKEN }),
    searchParams: Promise.resolve({ status: opts.status }),
  });
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveToken.mockResolvedValue({ access: "SUBMITTED", tenantId: "t-1", application: app() });
  getFee.mockResolvedValue(fee());
  reconcile.mockResolvedValue({ code: "NO_CHANGE" });
  feeFindUnique.mockResolvedValue({ id: "fee-1" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("metadata", () => {
  it("leaves the brand suffix to the root template and stays out of search", () => {
    expect(metadata.title).toBe("Pembayaran Biaya Pendaftaran");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("/pendaftaran/[token]/pembayaran", () => {
  it("asks the gateway first (throttled to 15s), then shows what is stored", async () => {
    getFee.mockResolvedValueOnce(fee()).mockResolvedValueOnce(fee({ status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" }));
    await renderPage({ status: "paid" });

    expect(feeFindUnique.mock.calls[0][0].where).toEqual({ applicationId: "app-1" });
    expect(reconcile).toHaveBeenCalledWith("fee-1", { minIntervalMs: 15_000 });
    // The stored state after the poll wins — a "paid" hint alone proves nothing.
    expect(screen.getByRole("heading", { name: "Pembayaran diterima" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bayar|Lanjutkan/ })).not.toBeInTheDocument();
  });

  it("a 'paid' hint on the URL does NOT show paid when the gateway has not confirmed", async () => {
    await renderPage({ status: "paid" });
    expect(screen.getByRole("heading", { name: "Menunggu pembayaran" })).toBeInTheDocument();
    expect(screen.queryByText(/Pembayaran diterima/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Periksa lagi" })).toBeInTheDocument();
  });

  it("a 'cancel' hint shows the not-finished wording and a way to try again", async () => {
    await renderPage({ status: "cancel" });
    expect(screen.getByRole("heading", { name: "Pembayaran belum selesai" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeInTheDocument();
  });

  it("a gateway outage never breaks the page: it shows the stored state", async () => {
    reconcile.mockRejectedValue(new Error("gateway down"));
    await renderPage();
    expect(screen.getByRole("heading", { name: "Menunggu pembayaran" })).toBeInTheDocument();
  });

  it("does not poll a fee whose payment never started", async () => {
    getFee.mockResolvedValue(fee({ started: false }));
    await renderPage();
    expect(reconcile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Bayar biaya pendaftaran" })).toBeInTheDocument();
  });

  it("does not poll a fee that is already settled", async () => {
    getFee.mockResolvedValue(fee({ status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" }));
    await renderPage();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("shows a waived fee as nothing to pay", async () => {
    getFee.mockResolvedValue(fee({ status: "WAIVED", amount: 0 }));
    await renderPage();
    expect(screen.getByRole("heading", { name: "Biaya pendaftaran dibebaskan" })).toBeInTheDocument();
  });

  it("a rejected application shows the fee but offers no payment", async () => {
    resolveToken.mockResolvedValue({ access: "SUBMITTED", tenantId: "t-1", application: app({ status: "REJECTED" }) });
    await renderPage();
    expect(screen.queryByRole("button", { name: /Bayar|Lanjutkan/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Pendaftaran ini tidak dilanjutkan/)).toBeInTheDocument();
  });

  it("a cancelled lead shows the fee but offers no payment", async () => {
    resolveToken.mockResolvedValue({ access: "SUBMITTED", tenantId: "t-1", application: app({ admission: { status: "CANCELLED" } }) });
    await renderPage();
    expect(screen.queryByRole("button", { name: /Bayar|Lanjutkan/ })).not.toBeInTheDocument();
  });

  it("an application with no fee says so instead of an empty page", async () => {
    getFee.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByRole("heading", { name: "Tidak ada biaya yang perlu dibayar" })).toBeInTheDocument();
  });

  it("links back to the form", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Kembali ke formulir pendaftaran" })).toHaveAttribute("href", `/pendaftaran/${TOKEN}`);
  });
});

describe("/pendaftaran/[token]/pembayaran — dead ends", () => {
  it("an unknown token is a generic not-found card, with no fee lookup", async () => {
    resolveToken.mockResolvedValue({ access: "NOT_FOUND", tenantId: undefined, application: null });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Tautan tidak ditemukan" })).toBeInTheDocument();
    expect(getFee).not.toHaveBeenCalled();
  });

  it("a malformed token never reaches the database", async () => {
    await renderPage({ token: "x".repeat(500) });
    expect(screen.getByRole("heading", { name: "Tautan tidak ditemukan" })).toBeInTheDocument();
    expect(resolveToken).not.toHaveBeenCalled();
  });

  it("a form that was never sent goes back to the form (nothing to pay yet)", async () => {
    resolveToken.mockResolvedValue({ access: "OK", tenantId: "t-1", application: app({ status: "INVITED" }) });
    await expect(renderPage()).rejects.toThrow(`REDIRECT:/pendaftaran/${TOKEN}`);
  });

  it("pay-first: an INVITED form whose fee is owed shows the payment panel (it is the destination, not a redirect)", async () => {
    resolveToken.mockResolvedValue({ access: "PAYMENT_REQUIRED", tenantId: "t-1", application: app({ status: "INVITED", childName: "" }) });
    getFee.mockResolvedValue(fee({ started: false }));
    await renderPage();
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("pay-first: once the fee is settled the form is open again and this page hands back to it", async () => {
    resolveToken.mockResolvedValue({ access: "OK", tenantId: "t-1", application: app({ status: "INVITED" }) });
    getFee.mockResolvedValue(fee({ status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" }));
    await expect(renderPage()).rejects.toThrow(`REDIRECT:/pendaftaran/${TOKEN}`);
  });

  it("an invite that lapsed unsent says the link expired", async () => {
    resolveToken.mockResolvedValue({ access: "EXPIRED", tenantId: "t-1", application: app({ status: "INVITED" }) });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Tautan sudah kedaluwarsa" })).toBeInTheDocument();
    expect(getFee).not.toHaveBeenCalled();
  });
});
