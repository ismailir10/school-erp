/**
 * Reopening the form link after submitting: the thank-you card now carries the
 * pendaftaran fee, so a parent who left before paying lands back on the way to
 * pay (cycle 2026-10-10-pendaftaran-fee-payment).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { resolveToken, getFee } = vi.hoisted(() => ({ resolveToken: vi.fn(), getFee: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/enrollment/resolve-token", () => ({ resolveEnrollmentToken: resolveToken }));
vi.mock("@/lib/enrollment/fee-view", () => ({ getPublicFeeView: getFee }));
vi.mock("@/lib/enrollment/fee-config", () => ({ getProgramFees: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/enrollment/required-documents", () => ({ getRequiredDocuments: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/contact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contact")>()),
  schoolContactPhone: () => null,
}));
vi.mock("@/app/pendaftaran/[token]/client", () => ({
  default: (props: Record<string, unknown>) => <div data-testid="form" data-props={Object.keys(props).sort().join(",")} />,
}));
vi.mock("@/components/brand/talib-wordmark", () => ({ TalibWordmark: () => null }));
vi.mock("@/components/brand/school-photos", () => ({ SchoolHero: () => null }));

import PendaftaranTokenPage from "../page";

const app = (over: Record<string, unknown> = {}) => ({
  id: "app-1",
  childName: "Aisyah",
  status: "SUBMITTED",
  documents: {},
  consentData: {},
  ...over,
});
const fee = (over: Record<string, unknown> = {}) => ({
  amount: 300_000,
  baseAmount: 300_000,
  discountPercent: 0,
  status: "UNPAID",
  paidAt: null,
  started: false,
  ...over,
});

async function renderPage() {
  render(await PendaftaranTokenPage({ params: Promise.resolve({ token: "tok" }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveToken.mockResolvedValue({ access: "SUBMITTED", tenantId: "t-1", application: app() });
  getFee.mockResolvedValue(fee());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("form link after submit", () => {
  it("an unpaid parent lands back on the way to pay, under the thank-you", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Formulir sudah diterima" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bayar biaya pendaftaran" })).toBeInTheDocument();
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("someone who already started paying is offered to continue", async () => {
    getFee.mockResolvedValue(fee({ started: true }));
    await renderPage();
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeInTheDocument();
  });

  it("a paid fee shows the receipt, not a pay button", async () => {
    getFee.mockResolvedValue(fee({ status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" }));
    await renderPage();
    expect(screen.getByRole("heading", { name: "Pembayaran diterima" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a free program shows the plain card, unchanged", async () => {
    getFee.mockResolvedValue(null);
    await renderPage();
    expect(screen.getByRole("heading", { name: "Formulir sudah diterima" })).toBeInTheDocument();
    expect(screen.queryByText(/biaya pendaftaran/i)).not.toBeInTheDocument();
  });

  it("a rejected application shows no pay button", async () => {
    resolveToken.mockResolvedValue({ access: "SUBMITTED", tenantId: "t-1", application: app({ status: "REJECTED" }) });
    await renderPage();
    expect(screen.queryByRole("button", { name: /Bayar/ })).not.toBeInTheDocument();
  });

  it("a cancelled lead shows no pay button either (its link is closed)", async () => {
    resolveToken.mockResolvedValue({ access: "SUBMITTED", tenantId: "t-1", application: app({ admission: { status: "CANCELLED" } }) });
    await renderPage();
    expect(screen.queryByRole("button", { name: /Bayar/ })).not.toBeInTheDocument();
  });

  it("a failed fee lookup never hides the thank-you card", async () => {
    getFee.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(screen.getByRole("heading", { name: "Formulir sudah diterima" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bayar/ })).not.toBeInTheDocument();
  });
});

describe("form link while the form is open (pay after submit)", () => {
  it.each([["UNPAID"], ["PAID"], ["WAIVED"], [null]])("opens the form straight away whatever the fee (%s)", async (status) => {
    // A fee row on an open form only exists for a formulir sent under pay-first (staging).
    resolveToken.mockResolvedValue({
      access: "OK",
      tenantId: "t-1",
      application: app({ status: "INVITED", programId: null, dcareAddon: false, studentData: {}, ayahData: {}, ibuData: {} }),
    });
    getFee.mockResolvedValue(status ? fee({ status }) : null);
    await renderPage();
    expect(screen.getByTestId("form")).toBeInTheDocument();
    // No locked-program prop any more: Program and Day Care are always the parent's to choose.
    expect(screen.getByTestId("form").dataset.props).toBe("prefill,programs,requiredDocuments,token");
    expect(screen.queryByRole("button", { name: /Bayar/ })).not.toBeInTheDocument();
  });
});
