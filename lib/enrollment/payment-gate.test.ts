import { describe, it, expect, vi, beforeEach } from "vitest";

const { appFindFirst, feeFindUnique, tenantFindUnique } = vi.hoisted(() => ({
  appFindFirst: vi.fn(),
  feeFindUnique: vi.fn(),
  tenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: { findFirst: appFindFirst },
    enrollmentFee: { findUnique: feeFindUnique },
    tenant: { findUnique: tenantFindUnique },
  },
}));

import { getPaymentGateView } from "./payment-gate";
import { ENROLLMENT_FORM_STEPS } from "./steps";
import { STEPS } from "@/app/pendaftaran/[token]/form-logic";
import { PAYMENT_REQUIRED_MESSAGE, paymentRequiredResponse } from "./payment-required";

const app = (over: Record<string, unknown> = {}) => ({
  status: "INVITED",
  dcareAddon: true,
  program: { name: "Kelompok Bermain" },
  admission: { status: "INQUIRY" },
  ...over,
});
const feeRow = (over: Record<string, unknown> = {}) => ({
  amount: "700000",
  baseAmount: "700000",
  discountPercent: 0,
  status: "UNPAID",
  paidAt: null,
  gatewaySessionId: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  appFindFirst.mockResolvedValue(app());
  feeFindUnique.mockResolvedValue(feeRow());
  tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["akta", "kk"] });
});

describe("getPaymentGateView", () => {
  it("gives the amount, the program and Day Care, the seven steps and the mandatory documents", async () => {
    const view = await getPaymentGateView("app-1", "t-1");
    expect(view).toEqual({
      programName: "Kelompok Bermain",
      dcareAddon: true,
      fee: { amount: 700_000, baseAmount: 700_000, discountPercent: 0, status: "UNPAID", paidAt: null, started: false },
      steps: ["Data Anak", "Data Ayah", "Data Ibu", "Program", "Berkas", "Persetujuan", "Tinjau"],
      requiredDocuments: [
        { key: "akta", label: "Akta kelahiran anak" },
        { key: "kk", label: "Kartu Keluarga (KK)" },
      ],
      closed: false,
    });
  });

  it("lists the form's seven step titles, in order", async () => {
    expect((await getPaymentGateView("app-1", "t-1"))?.steps).toEqual([
      "Data Anak", "Data Ayah", "Data Ibu", "Program", "Berkas", "Persetujuan", "Tinjau",
    ]);
    // The stepper reads the same list.
    expect(STEPS).toBe(ENROLLMENT_FORM_STEPS);
  });

  it("looks the application up by id AND tenant, and the school's own document requirement", async () => {
    await getPaymentGateView("app-1", "t-1");
    expect(appFindFirst.mock.calls[0][0].where).toEqual({ id: "app-1", tenantId: "t-1" });
    expect(tenantFindUnique.mock.calls[0][0].where).toEqual({ id: "t-1" });
  });

  it("is null for another tenant's (or an unknown) application: nothing is read for it", async () => {
    appFindFirst.mockResolvedValue(null);
    expect(await getPaymentGateView("app-1", "t-2")).toBeNull();
    expect(feeFindUnique).not.toHaveBeenCalled();
  });

  it("is null when the application has no fee: there is nothing to gate", async () => {
    feeFindUnique.mockResolvedValue(null);
    expect(await getPaymentGateView("app-1", "t-1")).toBeNull();
  });

  it("an empty requirement list when the school makes no upload mandatory; a removed program has no name", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
    appFindFirst.mockResolvedValue(app({ program: null, dcareAddon: false }));
    const view = await getPaymentGateView("app-1", "t-1");
    expect(view).toMatchObject({ programName: null, dcareAddon: false, requiredDocuments: [] });
  });

  it.each([
    ["rejected", { status: "REJECTED" }],
    ["its lead cancelled", { admission: { status: "CANCELLED" } }],
  ])("closed when the application is %s", async (_n, over) => {
    appFindFirst.mockResolvedValue(app(over));
    expect((await getPaymentGateView("app-1", "t-1"))?.closed).toBe(true);
  });

  it("leaks no personal data, link or gateway id", async () => {
    feeFindUnique.mockResolvedValue(feeRow({ gatewaySessionId: "SESS-SECRET", paymentUrl: "https://doku/SECRET" }));
    const text = JSON.stringify(await getPaymentGateView("app-1", "t-1"));
    expect(text).not.toMatch(/SECRET|childName|parent|accessToken|paymentUrl|gatewaySessionId/i);
    expect((await getPaymentGateView("app-1", "t-1"))?.fee.started).toBe(true);
  });
});

describe("paymentRequiredResponse", () => {
  it("is the one 409 every gated parent route answers with", async () => {
    const res = paymentRequiredResponse();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PAYMENT_REQUIRED", message: "Bayar biaya formulir dulu supaya formulir bisa diisi." });
    expect(PAYMENT_REQUIRED_MESSAGE).toBe("Bayar biaya formulir dulu supaya formulir bisa diisi.");
  });
});
