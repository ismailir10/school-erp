import { test, expect, type BrowserContext } from "@playwright/test";
import {
  CONSENT_VERSION,
  createInvite,
  fillAndSubmit,
  newAdminContext,
  newIpBlock,
  postSignature,
  prefillDraft,
  priceTwoPrograms,
  submitBody,
} from "./helpers/enrollment";

/**
 * Pendaftaran fee (cycles 2026-10-10-pendaftaran-fee-payment, 2026-10-11-pendaftaran-simplify and
 * 2026-10-15-pendaftaran-pay-after-form), end to end under DEMO_MODE (the gateway
 * answers with a synthetic payment link):
 *
 *  1. Staff set a fee on a program (Pengaturan → Pengaturan Pendaftaran API).
 *  2. PAY AFTER: sending a formulir creates NO fee and gates nothing: the parent's writes
 *     (autosave, signatures, submit) work unpaid, the public /pay route says NO_FEE until the
 *     form is submitted, and the submit prices the fee on the server from the program the
 *     parent chose in the form (the client never sends an amount) and hands back a link.
 *  3. A free program creates no fee at all, and a single parent (the other skipped) is priced
 *     the same way. "Tandai formulir masuk" prices like a parent submit.
 *  4. Admin list (/admin/admissions): the submitted, unpaid formulir shows Belum bayar, the
 *     filter finds it (a sent formulir with no fee yet does not), and the WhatsApp reminder is a
 *     REDIRECT built on click, so no JSON ever holds the parent's access token.
 *  5. Admin detail: the Pembayaran pendaftaran card; a discount re-prices from the normal fee;
 *     marking it paid flips it to Lunas and drops it from the unpaid list; the parent's link
 *     then reads as settled and a second submit creates no second fee.
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

test.describe("Pendaftaran fee", () => {
  let admin: BrowserContext;
  /** Priced at FEE for the whole spec. */
  let pricedId = "";
  /** Free for the whole spec: a formulir submitted on it has no fee row. */
  let freeId = "";
  let restoreFees: () => Promise<void> = async () => {};
  // The submitted, UNPAID formulir the list and detail tests work on.
  let token = "";
  let ip = "";
  let applicationId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    const priced = await priceTwoPrograms(admin.request, FEE);
    pricedId = priced.priced.id;
    freeId = priced.free.id;
    restoreFees = priced.restore;
  });

  test.afterAll(async () => {
    try {
      await restoreFees();
    } finally {
      await admin?.close();
    }
  });

  test("pay after: sending creates no fee and gates nothing; submit prices it and the pay route hands back a link", async () => {
    ip = nextIp();
    const invite = await createInvite(admin.request, { ip, child: CHILD, email: `e2e-biaya-${STAMP}@example.com` });
    token = invite.token;
    applicationId = invite.applicationId;

    // Sent, not submitted: no fee row, nothing to pay, nothing to chase.
    const sent = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
    expect(sent.fee).toBeNull();
    const early = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(early.status()).toBe(404);
    expect((await early.json()).error).toBe("NO_FEE");
    const chase = await admin.request.get(`/api/admissions?payment=unpaid&search=${encodeURIComponent(CHILD)}`);
    expect((await chase.json()).data.some((r: { id: string }) => r.id === invite.admissionId)).toBe(false);

    // The parent's writes all work before any payment: autosave (with the priced Program) and both signatures.
    await prefillDraft(admin.request, { token, ip, child: CHILD, programId: pricedId });
    for (const which of ["ayah", "ibu"] as const) {
      expect((await postSignature(admin.request, { token, ip, which })).status()).toBe(200);
    }
    // Still no fee: a draft is not a submission.
    expect((await (await admin.request.get(`/api/enrollments/${applicationId}`)).json()).fee).toBeNull();

    // Submit prices it on the server; the client never sends an amount.
    const submit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
      headers: { "X-Forwarded-For": ip },
      data: submitBody({ programId: pricedId, child: CHILD }),
    });
    expect(submit.status()).toBe(201);
    expect((await submit.json()).fee).toMatchObject({ baseAmount: FEE, amount: FEE, status: "UNPAID" });

    // Now there is something to pay, and the link works.
    const pay = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(pay.status()).toBe(200);
    expect(typeof (await pay.json()).paymentUrl).toBe("string");
  });

  test("a free program: filled and submitted with no fee row and no payment step", async () => {
    const freeIp = nextIp();
    const child = `E2E Gratis ${STAMP}`;
    const invite = await createInvite(admin.request, {
      ip: freeIp,
      child,
      email: `e2e-biaya-gratis-${STAMP}@example.com`,
    });
    const submit = await fillAndSubmit(admin.request, { token: invite.token, ip: freeIp, child, programId: freeId });
    expect(submit.status()).toBe(201);
    expect((await submit.json()).fee).toBeNull();

    const pay = await admin.request.post(`/api/enrollments/token/${invite.token}/pay`, {
      headers: { "X-Forwarded-For": freeIp },
    });
    // Submitted with no fee: the form is no longer open, so the route answers a plain 404 (no NO_FEE hint).
    expect(pay.status()).toBe(404);
    expect((await (await admin.request.get(`/api/enrollments/${invite.applicationId}`)).json()).fee).toBeNull();
  });

  test("a single parent (the other skipped) submits with the body the real form sends, and is priced", async () => {
    const singleIp = nextIp();
    // Not a superstring of CHILD: the list test below matches rows by that name.
    const child = `E2E Satu Orangtua ${STAMP}`;
    const invite = await createInvite(admin.request, {
      ip: singleIp,
      child,
      email: `e2e-biaya-satu-${STAMP}@example.com`,
    });
    // The parent picks the priced program while filling.
    await prefillDraft(admin.request, { token: invite.token, ip: singleIp, child, programId: pricedId });
    // Only the ibu signs; the ayah is skipped.
    expect((await postSignature(admin.request, { token: invite.token, ip: singleIp, which: "ibu" })).status()).toBe(200);

    const submit = await admin.request.post(`/api/enrollments/token/${invite.token}/submit`, {
      headers: { "X-Forwarded-For": singleIp },
      data: {
        ...submitBody({ programId: pricedId, child }),
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

  test("Tandai formulir masuk prices the fee like a parent submit, and the fee card can settle it",async () => {
    const markIp = nextIp();
    const child = `E2E Tandai Masuk ${STAMP}`;
    const invite = await createInvite(admin.request, {
      ip: markIp,
      child,
      email: `e2e-biaya-tandai-${STAMP}@example.com`,
    });
    // Staff typed the answers in for a family that filled it on paper: Program is on the formulir, no fee yet.
    await prefillDraft(admin.request, { token: invite.token, ip: markIp, child, programId: pricedId });
    expect((await (await admin.request.get(`/api/enrollments/${invite.applicationId}`)).json()).fee).toBeNull();

    const marked = await admin.request.post(`/api/enrollments/${invite.applicationId}/mark-submitted`);
    expect(marked.status()).toBe(200);
    expect((await marked.json()).fee).toMatchObject({ status: "UNPAID", amount: FEE });
    const detail = await (await admin.request.get(`/api/enrollments/${invite.applicationId}`)).json();
    expect(detail.fee).toMatchObject({ status: "UNPAID", baseAmount: FEE, amount: FEE });

    // The formulir fee card can settle it afterwards.
    const waived = await admin.request.patch(`/api/enrollments/${invite.applicationId}/fee`, { data: { action: "WAIVE" } });
    expect(waived.status()).toBe(200);
    expect((await (await admin.request.get(`/api/enrollments/${invite.applicationId}`)).json()).fee.status).toBe("WAIVED");
  });

  test("admin list: Belum bayar, the filter, and a WhatsApp reminder that never exposes the token in JSON", async () => {
    // The submitted formulir has an UNPAID fee: that is what the chase list is for.
    const list = await admin.request.get(`/api/admissions?payment=unpaid&search=${encodeURIComponent(CHILD)}`);
    expect(list.status()).toBe(200);
    const text = await list.text();
    // The access token is a credential: no list response may carry it.
    expect(text).not.toContain(token);
    expect(text).not.toContain("wa.me");
    const row = JSON.parse(text).data.find((r: { application: { id: string } | null }) => r.application?.id === applicationId);
    expect(row.stage).toBe("FORMULIR_MASUK");
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
      await expect(rowEl).toContainText("Formulir masuk");
      await expect(rowEl).toContainText("Belum bayar");
      // A click on the row menu made before the table hydrates is lost; retry the open until the menu shows.
      const reminderItem = page.getByRole("menuitem", { name: "Ingatkan bayar (WhatsApp)" });
      await expect(async () => {
        if (!(await reminderItem.isVisible())) await rowEl.getByRole("button", { name: `Aksi untuk ${CHILD}` }).click();
        await expect(reminderItem).toBeVisible({ timeout: 1_000 });
      }).toPass();
      await expect(reminderItem).toHaveAttribute("href", `/api/enrollments/${applicationId}/fee/reminder`);
    } finally {
      await page.close();
    }
  });

  test("admin detail: a discount re-prices from the normal fee, marking it paid settles it and closes the payment", async () => {
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

    // The parent's link reads as settled (no new payment session), and a second submit is refused
    // without making a second fee.
    const pay = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(pay.status()).toBe(200);
    expect(await pay.json()).toMatchObject({ status: "PAID" });
    const resubmit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
      headers: { "X-Forwarded-For": ip },
      data: submitBody({ programId: pricedId, child: CHILD }),
    });
    expect(resubmit.status()).toBe(409);
    detail = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
    expect(detail.fee).toMatchObject({ status: "PAID", amount: 150_000 });
  });
});
