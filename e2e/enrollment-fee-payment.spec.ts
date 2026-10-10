import { test, expect, type BrowserContext } from "@playwright/test";
import {
  CONSENT_VERSION,
  createInvite,
  newAdminContext,
  newIpBlock,
  postSignature,
  prefillDraft,
} from "./helpers/enrollment";

/**
 * Pendaftaran fee (cycle 2026-10-10-pendaftaran-fee-payment), end to end under
 * DEMO_MODE (the gateway answers with a synthetic payment link):
 *
 *  1. Staff set a fee on a program (Pengaturan → Pengaturan Pendaftaran API).
 *  2. A parent submits the form; the response carries the fee and the server
 *     priced it (the client never sends an amount).
 *  3. The public /pay route hands the parent a payment link.
 *  4. Admin list: the application shows Belum bayar, can be filtered, and the
 *     WhatsApp reminder is a REDIRECT built on click, so no JSON ever holds the
 *     parent's access token.
 *  5. Admin detail: the Pembayaran pendaftaran card; a discount re-prices from
 *     the normal fee; marking it paid flips it to Lunas and drops it from the
 *     unpaid list.
 *
 * The fee is a per-tenant setting shared by every spec, so the program's
 * original fee is restored in `afterAll`. Parent-side calls carry a unique
 * X-Forwarded-For so per-IP rate limits don't contend with other specs.
 */

const STAMP = Date.now();
const CHILD = `E2E Biaya ${STAMP}`;
const nextIp = newIpBlock(90);
const FEE = 300_000;

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("Pendaftaran fee", () => {
  let admin: BrowserContext;
  let programId = "";
  let originalFee = 0;
  let requiredDocuments: string[] = [];
  let token = "";
  let applicationId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    const res = await admin.request.get("/api/config/enrollment");
    expect(res.status()).toBe(200);
    const cfg = await res.json();
    requiredDocuments = cfg.requiredDocuments as string[];
    expect(cfg.programs.length).toBeGreaterThan(0);
    programId = cfg.programs[0].id as string;
    originalFee = cfg.programs[0].enrollmentFee as number;

    const put = await admin.request.put("/api/config/enrollment", {
      data: { requiredDocuments, programFees: [{ programId, fee: FEE }] },
    });
    expect(put.status()).toBe(200);
  });

  test.afterAll(async () => {
    try {
      await admin?.request.put("/api/config/enrollment", {
        data: { requiredDocuments, programFees: [{ programId, fee: originalFee }] },
      });
    } finally {
      await admin?.close();
    }
  });

  test("the parent submits and is priced on the server; the pay route hands back a link", async () => {
    const ip = nextIp();
    ({ token } = await createInvite(admin.request, { ip, child: CHILD, email: `e2e-biaya-${STAMP}@example.com` }));
    await prefillDraft(admin.request, { token, ip, child: CHILD, programId });
    for (const which of ["ayah", "ibu"] as const) {
      expect((await postSignature(admin.request, { token, ip, which })).status()).toBe(200);
    }

    // Not submitted yet: nothing to pay.
    const early = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(early.status()).toBe(409);

    const submit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
      headers: { "X-Forwarded-For": ip },
      data: {
        programId,
        dcareAddon: false,
        studentData: {
          childName: CHILD,
          childGender: "P",
          birthPlace: "Bekasi",
          dateOfBirth: "2021-03-15",
          agama: "ISLAM",
          kewarganegaraan: "WNI",
        },
        ayahData: { name: "E2E Ayah" },
        ibuData: { name: "E2E Ibu" },
        consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "E2E Ayah" }, ibu: { name: "E2E Ibu" } },
      },
    });
    expect(submit.status()).toBe(201);
    const body = await submit.json();
    expect(body.fee).toMatchObject({ baseAmount: FEE, amount: FEE, status: "UNPAID" });
    applicationId = body.id as string;

    const pay = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(pay.status()).toBe(200);
    expect(typeof (await pay.json()).paymentUrl).toBe("string");
  });

  test("admin list: Belum bayar, the filter, and a WhatsApp reminder that never exposes the token in JSON", async () => {
    const list = await admin.request.get(`/api/enrollments?payment=unpaid&search=${encodeURIComponent(CHILD)}`);
    expect(list.status()).toBe(200);
    const text = await list.text();
    // The access token is a credential: no list response may carry it.
    expect(text).not.toContain(token);
    expect(text).not.toContain("wa.me");
    const row = JSON.parse(text).data.find((r: { id: string }) => r.id === applicationId);
    expect(row.fee).toEqual({ status: "UNPAID", amount: FEE });
    expect(row.followUp).toEqual({ canRemind: true });

    // One tap → a redirect to the parent's WhatsApp with the form link written.
    const reminder = await admin.request.get(`/api/enrollments/${applicationId}/fee/reminder`, { maxRedirects: 0 });
    expect(reminder.status()).toBe(302);
    expect(reminder.headers()["cache-control"]).toContain("no-store");
    const location = reminder.headers()["location"];
    expect(location.startsWith("https://wa.me/6281200000001?text=")).toBe(true);
    expect(decodeURIComponent(location.split("?text=")[1])).toContain(`/pendaftaran/${token}`);

    const page = await admin.newPage();
    try {
      await page.goto("/admin/enrollments");
      await page.getByPlaceholder("Cari nama anak atau email orang tua...").fill(CHILD);
      const rowEl = page.getByRole("row").filter({ hasText: CHILD });
      await expect(rowEl).toContainText("Belum bayar");
      await expect(rowEl.getByRole("link", { name: `Ingatkan lewat WhatsApp: ${CHILD}` })).toHaveAttribute(
        "href",
        `/api/enrollments/${applicationId}/fee/reminder`,
      );
    } finally {
      await page.close();
    }
  });

  test("admin detail: a discount re-prices from the normal fee, marking it paid settles it", async () => {
    const page = await admin.newPage();
    try {
      await page.goto(`/admin/enrollments/${applicationId}`);
      await expect(page.getByRole("heading", { name: "Pembayaran pendaftaran" })).toBeVisible();
      await expect(page.getByText("Harus dibayar")).toBeVisible();
      await expect(page.getByRole("link", { name: /^Chat WhatsApp: ingatkan orang tua/ })).toBeVisible();
    } finally {
      await page.close();
    }

    // A discount needs a reason.
    const noReason = await admin.request.patch(`/api/enrollments/${applicationId}/fee`, {
      data: { action: "DISCOUNT", discountPercent: 20 },
    });
    expect(noReason.status()).toBe(400);

    const discount = await admin.request.patch(`/api/enrollments/${applicationId}/fee`, {
      data: { action: "DISCOUNT", discountPercent: 20, reason: "Early bird" },
    });
    expect(discount.status()).toBe(200);
    let detail = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
    expect(detail.fee).toMatchObject({ status: "UNPAID", baseAmount: FEE, amount: 240_000, discountPercent: 20 });

    // A second discount is computed from the normal fee, not from the discounted one.
    await admin.request.patch(`/api/enrollments/${applicationId}/fee`, {
      data: { action: "DISCOUNT", discountPercent: 50, reason: "Kakak-adik" },
    });
    detail = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
    expect(detail.fee.amount).toBe(150_000);

    const paid = await admin.request.patch(`/api/enrollments/${applicationId}/fee`, {
      data: { action: "MARK_PAID", method: "BANK_TRANSFER", note: "Bukti 123" },
    });
    expect(paid.status()).toBe(200);
    detail = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
    expect(detail.fee).toMatchObject({ status: "PAID", method: "BANK_TRANSFER", amount: 150_000 });
    expect(detail.followUp).toBeNull();

    // Settled: it cannot be changed again, and drops off the chase list.
    const again = await admin.request.patch(`/api/enrollments/${applicationId}/fee`, { data: { action: "WAIVE" } });
    expect(again.status()).toBe(409);
    const unpaid = await (
      await admin.request.get(`/api/enrollments?payment=unpaid&search=${encodeURIComponent(CHILD)}`)
    ).json();
    expect(unpaid.data.some((r: { id: string }) => r.id === applicationId)).toBe(false);

    // Nothing left to remind.
    const reminder = await admin.request.get(`/api/enrollments/${applicationId}/fee/reminder`, { maxRedirects: 0 });
    expect(reminder.status()).toBe(409);
  });
});
