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
 * Pendaftaran fee (cycles 2026-10-10-pendaftaran-fee-payment and
 * 2026-10-11-pendaftaran-simplify), end to end under DEMO_MODE (the gateway
 * answers with a synthetic payment link):
 *
 *  1. Staff set a fee on a program (Pengaturan → Pengaturan Pendaftaran API).
 *  2. PAY FIRST: sending a formulir on that program creates the fee right then;
 *     the parent's writes (autosave, submit) are refused 409 PAYMENT_REQUIRED
 *     while it is UNPAID, and the public /pay route already hands out a link.
 *  3. LEGACY ORDER: a formulir with no fee row (here: sent on a free program)
 *     is filled first and priced on the server at submit; the client never sends
 *     an amount.
 *  4. Admin list (/admin/admissions): the unpaid, sent formulir shows Belum bayar,
 *     the filter finds it, and the WhatsApp reminder is a REDIRECT built on click,
 *     so no JSON ever holds the parent's access token.
 *  5. Admin detail: the Pembayaran pendaftaran card; a discount re-prices from the
 *     normal fee; marking it paid flips it to Lunas, opens the form for the parent
 *     and drops it from the unpaid list; the parent's submit then creates no
 *     second fee.
 *
 * The fee is a per-tenant setting shared by every spec, so the programs' original
 * fees are restored in `afterAll`. Parent-side calls carry a unique
 * X-Forwarded-For so per-IP rate limits don't contend with other specs.
 */

const STAMP = Date.now();
const CHILD = `E2E Biaya ${STAMP}`;
const nextIp = newIpBlock(90);
const FEE = 300_000;

test.describe.configure({ mode: "serial", timeout: 90_000 });

function submitBody(programId: string, child: string) {
  return {
    programId,
    dcareAddon: false,
    studentData: {
      childName: child,
      childGender: "P",
      birthPlace: "Bekasi",
      dateOfBirth: "2021-03-15",
      agama: "ISLAM",
      kewarganegaraan: "WNI",
    },
    ayahData: { name: "E2E Ayah" },
    ibuData: { name: "E2E Ibu" },
    consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "E2E Ayah" }, ibu: { name: "E2E Ibu" } },
  };
}

test.describe("Pendaftaran fee", () => {
  let admin: BrowserContext;
  /** Priced at FEE for the whole spec. */
  let pricedId = "";
  /** Free for the whole spec: a formulir sent on it has no fee row (the old order). */
  let freeId = "";
  let original: { id: string; fee: number }[] = [];
  let requiredDocuments: string[] = [];
  // The pay-first formulir (UNPAID) the list and detail tests work on.
  let token = "";
  let ip = "";
  let applicationId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    const res = await admin.request.get("/api/config/enrollment");
    expect(res.status()).toBe(200);
    const cfg = await res.json();
    requiredDocuments = cfg.requiredDocuments as string[];
    expect(cfg.programs.length).toBeGreaterThan(1);
    pricedId = cfg.programs[0].id as string;
    freeId = cfg.programs[1].id as string;
    original = [
      { id: pricedId, fee: cfg.programs[0].enrollmentFee as number },
      { id: freeId, fee: cfg.programs[1].enrollmentFee as number },
    ];

    const put = await admin.request.put("/api/config/enrollment", {
      data: {
        requiredDocuments,
        programFees: [
          { programId: pricedId, fee: FEE },
          { programId: freeId, fee: 0 },
        ],
      },
    });
    expect(put.status()).toBe(200);
  });

  test.afterAll(async () => {
    try {
      await admin?.request.put("/api/config/enrollment", {
        data: { requiredDocuments, programFees: original.map((o) => ({ programId: o.id, fee: o.fee })) },
      });
    } finally {
      await admin?.close();
    }
  });

  test("pay first: sending prices the fee, the parent is gated until it is settled, the pay route already hands back a link", async () => {
    ip = nextIp();
    const invite = await createInvite(admin.request, {
      ip,
      child: CHILD,
      email: `e2e-biaya-${STAMP}@example.com`,
      programId: pricedId,
      settle: false,
    });
    token = invite.token;
    applicationId = invite.applicationId;
    // The server priced it from the program; the client never sends an amount.
    expect(invite.fee).toMatchObject({ status: "UNPAID", amount: FEE });

    // Every parent-side write is refused while the fee is owed...
    const autosave = await admin.request.patch(`/api/enrollments/token/${token}`, {
      headers: { "X-Forwarded-For": ip },
      data: { studentData: { childName: CHILD } },
    });
    expect(autosave.status()).toBe(409);
    expect((await autosave.json()).error).toBe("PAYMENT_REQUIRED");
    const submit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
      headers: { "X-Forwarded-For": ip },
      data: submitBody(pricedId, CHILD),
    });
    expect(submit.status()).toBe(409);
    expect((await submit.json()).error).toBe("PAYMENT_REQUIRED");

    // ...but paying is exactly what the parent may do: the link works before any submit.
    const pay = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(pay.status()).toBe(200);
    expect(typeof (await pay.json()).paymentUrl).toBe("string");
  });

  test("old order: a formulir with no fee row is filled first and priced on the server at submit", async () => {
    const legacyIp = nextIp();
    const child = `E2E Urutan Lama ${STAMP}`;
    // Sent on the free program: no fee row, so the form is open and nothing is owed yet.
    const invite = await createInvite(admin.request, {
      ip: legacyIp,
      child,
      email: `e2e-biaya-lama-${STAMP}@example.com`,
      programId: freeId,
    });
    expect(invite.fee).toBeNull();
    // The parent picks the priced program while filling.
    await prefillDraft(admin.request, { token: invite.token, ip: legacyIp, child, programId: pricedId });
    for (const which of ["ayah", "ibu"] as const) {
      expect((await postSignature(admin.request, { token: invite.token, ip: legacyIp, which })).status()).toBe(200);
    }

    // Not submitted yet and nothing to pay.
    const early = await admin.request.post(`/api/enrollments/token/${invite.token}/pay`, {
      headers: { "X-Forwarded-For": legacyIp },
    });
    expect(early.status()).toBe(404);
    expect((await early.json()).error).toBe("NO_FEE");

    const submit = await admin.request.post(`/api/enrollments/token/${invite.token}/submit`, {
      headers: { "X-Forwarded-For": legacyIp },
      data: submitBody(pricedId, child),
    });
    expect(submit.status()).toBe(201);
    expect((await submit.json()).fee).toMatchObject({ baseAmount: FEE, amount: FEE, status: "UNPAID" });

    const pay = await admin.request.post(`/api/enrollments/token/${invite.token}/pay`, {
      headers: { "X-Forwarded-For": legacyIp },
    });
    expect(pay.status()).toBe(200);
    expect(typeof (await pay.json()).paymentUrl).toBe("string");
  });

  test("old order, a single parent (the other skipped) submits with the body the real form sends, and is still priced", async () => {
    const singleIp = nextIp();
    // Not a superstring of CHILD: the list test below matches rows by that name.
    const child = `E2E Satu Orangtua ${STAMP}`;
    const invite = await createInvite(admin.request, {
      ip: singleIp,
      child,
      email: `e2e-biaya-satu-${STAMP}@example.com`,
      programId: freeId,
    });
    await prefillDraft(admin.request, { token: invite.token, ip: singleIp, child, programId: pricedId });
    // Only the ibu signs; the ayah is skipped.
    expect((await postSignature(admin.request, { token: invite.token, ip: singleIp, which: "ibu" })).status()).toBe(200);

    const submit = await admin.request.post(`/api/enrollments/token/${invite.token}/submit`, {
      headers: { "X-Forwarded-For": singleIp },
      data: {
        ...submitBody(pricedId, child),
        // The form always sends BOTH blocks: the skipped parent's one arrives blank.
        ayahData: { name: "", phone: "", email: "", address: { perumahan: "" } },
        consentData: {
          agreed: true,
          version: CONSENT_VERSION,
          onlyParent: "ibu",
          ayah: { name: "" },
          ibu: { name: "E2E Ibu" },
        },
      },
    });
    expect(submit.status()).toBe(201);
    expect((await submit.json()).fee).toMatchObject({ amount: FEE, status: "UNPAID" });
  });

  test("admin list: Belum bayar, the filter, and a WhatsApp reminder that never exposes the token in JSON", async () => {
    // The pay-first formulir is only INVITED, and it is already chased: that is the point of paying first.
    const list = await admin.request.get(`/api/admissions?payment=unpaid&search=${encodeURIComponent(CHILD)}`);
    expect(list.status()).toBe(200);
    const text = await list.text();
    // The access token is a credential: no list response may carry it.
    expect(text).not.toContain(token);
    expect(text).not.toContain("wa.me");
    const row = JSON.parse(text).data.find((r: { application: { id: string } | null }) => r.application?.id === applicationId);
    expect(row.stage).toBe("FORMULIR_DIKIRIM");
    expect(row.payment).toBe("UNPAID");
    expect(row.application.fee).toEqual({ status: "UNPAID", amount: FEE, canRemind: true });

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
      // The old Formulir list is gone: its address lands on the unified Pendaftaran list.
      await expect(page).toHaveURL(/\/admin\/admissions/);
      await page.getByPlaceholder("Cari nama anak atau orang tua...").fill(CHILD);
      const rowEl = page.getByRole("row").filter({ hasText: CHILD });
      await expect(rowEl).toContainText("Formulir dikirim");
      await expect(rowEl).toContainText("Belum bayar");
      await rowEl.getByRole("button", { name: `Aksi untuk ${CHILD}` }).click();
      await expect(page.getByRole("menuitem", { name: "Ingatkan bayar (WhatsApp)" })).toHaveAttribute(
        "href",
        `/api/enrollments/${applicationId}/fee/reminder`,
      );
    } finally {
      await page.close();
    }
  });

  test("admin detail: a discount re-prices from the normal fee, marking it paid settles it and opens the form", async () => {
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
      await admin.request.get(`/api/admissions?payment=unpaid&search=${encodeURIComponent(CHILD)}`)
    ).json();
    expect(unpaid.data.some((r: { application: { id: string } | null }) => r.application?.id === applicationId)).toBe(false);

    // Nothing left to remind.
    const reminder = await admin.request.get(`/api/enrollments/${applicationId}/fee/reminder`, { maxRedirects: 0 });
    expect(reminder.status()).toBe(409);

    // The gate is lifted: the parent can fill and submit, and the program stays the one the fee was
    // priced for. Submit creates no second fee (the pay-first fee is the only one).
    await prefillDraft(admin.request, { token, ip, child: CHILD, programId: pricedId });
    for (const which of ["ayah", "ibu"] as const) {
      expect((await postSignature(admin.request, { token, ip, which })).status()).toBe(200);
    }
    const submit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
      headers: { "X-Forwarded-For": ip },
      data: submitBody(pricedId, CHILD),
    });
    expect(submit.status()).toBe(201);
    expect(await submit.json()).toMatchObject({ id: applicationId, fee: null, feeStatus: "PAID" });
    detail = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
    expect(detail.fee).toMatchObject({ status: "PAID", amount: 150_000 });
  });
});
