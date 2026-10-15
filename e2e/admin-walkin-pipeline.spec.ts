import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  createInvite,
  fillAndSubmit,
  newAdminContext,
  newIpBlock,
  postSignature,
  prefillDraft,
  priceTwoPrograms,
  type ProgramFee,
} from "./helpers/enrollment";
import { storeLegacyLeadStatus } from "./helpers/legacy-lead";

/**
 * The one Pendaftaran pipeline, lead to student (cycles 2026-10-11-pendaftaran-simplify and
 * 2026-10-15-pendaftaran-pay-after-form).
 *
 * There is a single list (/admin/admissions), a single convert ("Terima & Jadikan Siswa" on the
 * formulir), and the stage of a family is derived. The pendaftaran fee is paid AFTER the form:
 * "Kirim Formulir" is one tap that picks no program and creates no fee; the parent chooses
 * Program + Day Care in the form, and submit creates the fee.
 *
 *  (a) WALK-IN, no email: Catat Pertanyaan with parent name + phone only → Kirim Formulir (one
 *      tap, no fee on the result card) → "Isi bersama orang tua" opens the real form, unpaid, and
 *      kode pos 12950 fills the region → the form is submitted → row "Formulir masuk" + "Belum
 *      bayar" → the formulir's fee card settles it in cash → Ubah data fixes a field → Terima &
 *      Jadikan Siswa → the student and both wali exist, the student's address reads the full
 *      joined address, row "Siswa".
 *  (b) PAY AFTER, parent side: the link opens the form with an unpaid (not yet existing) fee,
 *      autosave works, the parent picks Program in the form, submits, and the thank-you card
 *      offers "Bayar sekarang".
 *  (c) LEGACY: a lead stored as VISITED reads as "Baru" and can be sent a formulir.
 *  (d) CANCEL: cancelling a lead closes its unpaid payment link (409 APPLICATION_CLOSED).
 *
 * Only the UI steps that are specific to this cycle are driven through the browser; the parent's
 * 7-step wizard is covered by enrollment-documents / enrollment-signature-handover, so the heavy
 * parent steps here go through the real token API. Programs' fees are a per-school setting shared
 * by every spec: the original fees are restored in afterAll.
 */

const STAMP = Date.now();
const FEE = 275_000;
const nextIp = newIpBlock(91);

test.describe.configure({ mode: "serial", timeout: 120_000 });

type WilayahEntry = { kodePos: string; kelurahan: string; kecamatan: string; kotaKab: string; provinsi: string };

test.describe("Pendaftaran pipeline — lead to student", () => {
  let admin: BrowserContext;
  let priced: ProgramFee;
  let free: ProgramFee;
  let restoreFees: () => Promise<void> = async () => {};

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    ({ priced, free, restore: restoreFees } = await priceTwoPrograms(admin.request, FEE));
  });

  test.afterAll(async () => {
    try {
      await restoreFees();
    } finally {
      await admin?.close();
    }
  });

  async function searchList(page: Page, text: string) {
    await page.goto("/admin/admissions");
    await page.getByPlaceholder("Cari nama anak atau orang tua...").fill(text);
    return page.getByRole("row").filter({ hasText: text });
  }

  test("(a) walk-in without email: lead → one-tap formulir → form filled → paid in cash → Ubah data → Terima & Jadikan Siswa", async () => {
    const PARENT = `E2E Walkin ${STAMP}`;
    const CHILD = `E2E Walkin Anak ${STAMP}`;
    const page = await admin.newPage();
    try {
      // 1. Catat Pertanyaan: parent name + phone, nothing else.
      await page.goto("/admin/admissions");
      await page.getByRole("button", { name: "Catat Pertanyaan" }).first().click();
      const leadDialog = page.locator('[data-slot="dialog-content"]').first();
      await expect(leadDialog).toBeVisible();
      await leadDialog.getByLabel(/^Nama orang tua/).fill(PARENT);
      await leadDialog.getByLabel(/^No\. HP/).fill("081211112222");
      const created = page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/admissions" && res.request().method() === "POST",
      );
      await leadDialog.getByRole("button", { name: "Catat Pertanyaan" }).click();
      expect((await created).status()).toBe(201);
      await expect(leadDialog).toBeHidden();

      // 2. The row is "Baru" with its primary action, and it has no formulir yet.
      const row = page.getByRole("row").filter({ hasText: PARENT });
      await expect(row).toContainText("Baru");
      await expect(row).toContainText("Belum diisi");

      // 3. Kirim Formulir is ONE tap: no Program / Day Care question, no fee, straight to the result card.
      const invited = page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/enrollments/invite" && res.request().method() === "POST",
      );
      await row.getByRole("button", { name: `Kirim Formulir: ${PARENT}` }).click();
      const inviteRes = await invited;
      expect(inviteRes.status()).toBe(200);
      expect(inviteRes.request().postDataJSON()).toEqual({ admissionId: expect.any(String) });
      const inviteBody = await inviteRes.json();
      expect(inviteBody).toMatchObject({ hasEmail: false, emailed: false });
      expect(inviteBody).not.toHaveProperty("fee");

      // 4. The result card: link and ways to share it; no fee block, nothing to settle yet.
      const card = page.locator('[data-slot="dialog-content"]').first();
      await expect(card.locator('[data-slot="dialog-title"]')).toHaveText("Formulir siap dikirim");
      await expect(card).toContainText("Tidak ada email");
      await expect(card).toContainText("dibayar orang tua setelah mengisi dan mengirim formulir");
      await expect(card.getByTestId("formulir-fee")).toHaveCount(0);
      await expect(card.getByRole("button", { name: /Tandai lunas|Bebaskan/ })).toHaveCount(0);
      await expect(page.locator("#kirim-formulir-program")).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Salin tautan" })).toBeVisible();

      // 5. "Isi bersama orang tua" is the real parent form, open at once (nothing was paid).
      const together = card.getByRole("link", { name: /Isi bersama orang tua/ });
      const formUrl = (await together.getAttribute("href")) ?? "";
      expect(formUrl).toContain("/pendaftaran/");
      const token = formUrl.split("/pendaftaran/")[1];
      const ip = nextIp();
      const parentCtx = await page.context().browser()!.newContext({ extraHTTPHeaders: { "X-Forwarded-For": ip } });
      try {
        const parentPage = await parentCtx.newPage();
        await parentPage.goto(formUrl);
        await expect(parentPage.getByRole("heading", { name: "Formulir Pendaftaran Murid Baru" })).toBeVisible();
        await expect(parentPage.getByText("Bayar dulu")).toHaveCount(0);
        await expect(parentPage).not.toHaveURL(/pembayaran/);

        // Kode pos 12950 fills the kelurahan in the form itself.
        const toDataAnak = parentPage.getByRole("button", { name: "1. Data Anak" });
        if (await toDataAnak.isVisible()) await toDataAnak.click();
        const childAddress = parentPage.getByRole("group", { name: "Alamat anak" });
        await childAddress.getByLabel("Kode pos").fill("12950");
        await expect(childAddress.getByLabel("Kelurahan / Desa")).toHaveValue("Kuningan Timur");
        await expect(childAddress.getByLabel("Kecamatan")).toHaveValue("Setiabudi");
        await expect(childAddress.getByLabel("Provinsi")).toHaveValue(/Jakarta/);
      } finally {
        await parentCtx.close();
      }
      await card.getByRole("button", { name: "Selesai" }).click();
      await expect(card).toBeHidden();

      // 6. The same form is filled and submitted (token API: the wizard has its own specs). The
      //    address is what the lookup route answers for 12950, the way the form's own lookup got it.
      const lookup = await admin.request.get(`/api/enrollments/token/${token}/wilayah?kodepos=12950`, {
        headers: { "X-Forwarded-For": ip },
      });
      expect(lookup.status()).toBe(200);
      const results = (await lookup.json()).results as WilayahEntry[];
      const address = results.find((r) => r.kelurahan === "Kuningan Timur")!;
      expect(address).toBeTruthy();
      const submit = await fillAndSubmit(admin.request, {
        token,
        ip,
        child: CHILD,
        programId: priced.id,
        address: { perumahan: "Jl. Walk-in 1", blokCluster: "A2", rtRw: "003/004", ...address },
      });
      expect(submit.status()).toBe(201);
      // Pay-after: the fee is created by this submit, priced from the program the parent chose.
      expect((await submit.json()).fee).toMatchObject({ baseAmount: FEE, amount: FEE, status: "UNPAID" });

      // 7. Same list, same row: "Formulir masuk", still owed.
      const submittedRow = await searchList(page, PARENT);
      await expect(submittedRow).toContainText("Formulir masuk");
      await expect(submittedRow).toContainText("Belum bayar");
      await submittedRow.getByRole("link", { name: /^Buka formulir: / }).click();
      await page.waitForURL(/\/admin\/enrollments\/[^/]+$/);
      const appId = new URL(page.url()).pathname.split("/").pop()!;

      // 8. The formulir's fee card settles it in cash.
      const feeCard = page.getByRole("region", { name: "Pembayaran pendaftaran" });
      await expect(feeCard).toContainText("275.000");
      await feeCard.getByRole("button", { name: "Tandai sudah bayar" }).click();
      const payDialog = page.getByRole("dialog", { name: "Tandai sudah bayar" });
      await payDialog.locator("#enrollment-fee-method").click();
      await page.getByRole("option", { name: "Tunai", exact: true }).click();
      const settled = page.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/enrollments/${appId}/fee` && res.request().method() === "PATCH",
      );
      await payDialog.getByRole("button", { name: /^Catat / }).click();
      expect((await settled).status()).toBe(200);
      await expect(feeCard).toContainText("Lunas");

      // 9. Ubah data: fix one field, nothing else changes.
      await page.getByRole("button", { name: "Aksi lainnya" }).click();
      await page.getByRole("menuitem", { name: "Ubah data" }).click();
      await expect(page.getByRole("heading", { name: "Ubah data formulir" })).toBeVisible();
      await page.getByRole("region", { name: "Data anak" }).getByLabel("Tempat lahir").fill("Jakarta");
      const patched = page.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/enrollments/${appId}` && res.request().method() === "PATCH",
      );
      await page.getByRole("button", { name: "Simpan Perubahan" }).click();
      expect((await patched).status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Ubah data formulir" })).toBeHidden();
      const detail = await (await admin.request.get(`/api/enrollments/${appId}`)).json();
      expect(detail.studentData).toMatchObject({ childName: CHILD, birthPlace: "Jakarta", dateOfBirth: "2021-03-15" });
      expect(detail.fee).toMatchObject({ status: "PAID", method: "CASH", amount: FEE });

      // 10. One convert, one confirm.
      await page.getByRole("button", { name: "Terima & Jadikan Siswa" }).click();
      const converted = page.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/enrollments/${appId}/convert` && res.request().method() === "POST",
      );
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Terima & Jadikan Siswa" })
        .click();
      const convertRes = await converted;
      expect(convertRes.status()).toBe(200);
      const convertBody = await convertRes.json();
      expect(convertBody.student.name).toBe(CHILD);
      expect(Array.isArray(convertBody.reusedGuardians)).toBe(true);
      await expect(page.getByText("sudah dikonversi menjadi data siswa")).toBeVisible();

      // 11. The student exists with both wali and the full joined address; the list row now reads "Siswa".
      const student = await (await admin.request.get(`/api/students/${convertBody.student.id}`)).json();
      const relationships = (student.guardians as { relationship: string }[]).map((g) => g.relationship).sort();
      expect(relationships).toEqual(["AYAH", "IBU"]);
      expect(student.address).toContain("Jl. Walk-in 1");
      expect(student.address).toContain("Kuningan Timur");
      expect(student.address).toContain("12950");

      const studentRow = await searchList(page, PARENT);
      await expect(studentRow).toContainText("Siswa");
      await expect(studentRow.getByRole("link", { name: /^Lihat siswa: / })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("(b) pay after: the link opens the form unpaid, autosave and submit work, the thank-you card offers Bayar sekarang", async ({
    browser,
  }) => {
    const ip = nextIp();
    const child = `E2E Bayar Nanti ${STAMP}`;
    const invite = await createInvite(admin.request, { ip, child, email: `e2e-bayar-nanti-${STAMP}@example.com` });
    const { token, applicationId } = invite;

    // Nothing was created at send: no fee row yet, so nothing to pay.
    expect((await (await admin.request.get(`/api/enrollments/${applicationId}`)).json()).fee).toBeNull();
    const early = await admin.request.post(`/api/enrollments/token/${token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(early.status()).toBe(404);
    expect((await early.json()).error).toBe("NO_FEE");

    const parent = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "X-Forwarded-For": ip } });
    try {
      const page = await parent.newPage();

      // The token page is the form, not a pay screen.
      await page.goto(`/pendaftaran/${token}`);
      await expect(page).not.toHaveURL(/pembayaran/);
      await expect(page.getByRole("heading", { name: "Formulir Pendaftaran Murid Baru" })).toBeVisible();
      await expect(page.getByRole("list", { name: "Langkah formulir" })).toBeVisible();
      await expect(page.getByText("Bayar dulu")).toHaveCount(0);

      // Every write works unpaid: autosave (with the free program first), signatures, then the browser walks on.
      await prefillDraft(parent.request, { token, ip, child, programId: free.id });
      for (const which of ["ayah", "ibu"] as const) {
        expect((await postSignature(parent.request, { token, ip, which })).status()).toBe(200);
      }
      await page.goto(`/pendaftaran/${token}`);
      const toDataAnak = page.getByRole("button", { name: "1. Data Anak" });
      if (await toDataAnak.isVisible()) await toDataAnak.click();
      for (const heading of ["Data Anak", "Data Ayah", "Data Ibu", "Pilihan Program"]) {
        if (heading !== "Data Anak") await page.getByRole("button", { name: "Lanjut" }).click();
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }

      // The Program step is the parent's to choose again (it was locked under pay-first).
      const program = page.getByLabel(/^Program/);
      await expect(program).toBeEnabled();
      await expect(program).toHaveValue(free.id);
      await program.selectOption(priced.id);

      // Tinjau shows the address block's heading data and the price, paid after sending.
      await page.getByRole("button", { name: "Lanjut" }).click(); // Berkas
      await page.getByRole("button", { name: "Lanjut" }).click(); // Persetujuan
      await page.getByRole("button", { name: "Lanjut" }).click(); // Tinjau
      await expect(page.getByRole("heading", { name: /Tinjau/ })).toBeVisible();
      const feeSection = page.getByRole("region", { name: "Biaya pendaftaran" });
      await expect(feeSection).toContainText("275.000");
      await expect(feeSection).toContainText("dibayar setelah formulir dikirim");

      const submitted = page.waitForResponse(
        (res) => new URL(res.url()).pathname === `/api/enrollments/token/${token}/submit` && res.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Kirim Formulir" }).click();
      const submitRes = await submitted;
      expect(submitRes.status()).toBe(201);
      expect((await submitRes.json()).fee).toMatchObject({ baseAmount: FEE, amount: FEE, status: "UNPAID" });

      // Thank-you card: the one payment step.
      await expect(page.getByRole("heading", { name: /Jazakumullah khairan/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Bayar sekarang" })).toBeVisible();
      await expect(page.getByText("275.000").first()).toBeVisible();

      // One UNPAID fee for the program the parent chose in the form.
      const detail = await (await admin.request.get(`/api/enrollments/${applicationId}`)).json();
      expect(detail.program?.id).toBe(priced.id);
      expect(detail.fee).toMatchObject({ status: "UNPAID", baseAmount: FEE, amount: FEE });

      // Reopening the unpaid link shows the payment card, not the form.
      await page.goto(`/pendaftaran/${token}`);
      await expect(page.getByRole("button", { name: "Bayar sekarang" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Pilihan Program", exact: true })).toHaveCount(0);
    } finally {
      await parent.close();
    }
  });

  test("(c) legacy: a lead stored as VISITED shows Baru and can be sent a formulir in one tap", async () => {
    const PARENT = `E2E Lama ${STAMP}`;
    const create = await admin.request.post("/api/admissions", {
      data: { parentName: PARENT, parentPhone: "081233334444", parentRelationship: "IBU", childName: `E2E Lama Anak ${STAMP}` },
    });
    expect(create.status()).toBe(201);
    const lead = (await create.json()) as { id: string };
    await storeLegacyLeadStatus(lead.id, "VISITED");

    // The API reads it as Baru; its stored value is untouched.
    const listed = await admin.request.get(`/api/admissions?tahap=BARU&search=${encodeURIComponent(PARENT)}`);
    const apiRow = (await listed.json()).data.find((r: { id: string }) => r.id === lead.id);
    expect(apiRow).toMatchObject({ status: "VISITED", stage: "BARU", payment: "NONE" });

    const page = await admin.newPage();
    try {
      const row = await searchList(page, PARENT);
      await expect(row).toContainText("Baru");
      await expect(row).not.toContainText("Kunjungan");
      // The primary action is the Baru one, so the family can continue: one tap, no questions.
      const invited = page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/enrollments/invite" && res.request().method() === "POST",
      );
      await row.getByRole("button", { name: /^Kirim Formulir: / }).click();
      const res = await invited;
      expect(res.status()).toBe(200);
      expect(await res.json()).not.toHaveProperty("fee");
      await expect(page.locator('[data-slot="dialog-title"]').first()).toHaveText("Formulir siap dikirim");
      await expect(page.getByTestId("formulir-fee")).toHaveCount(0);
      await page.getByRole("button", { name: "Selesai" }).click();

      const sentRow = await searchList(page, PARENT);
      await expect(sentRow).toContainText("Formulir dikirim");
      // No fee yet, so nothing is owed.
      await expect(sentRow).not.toContainText("Belum bayar");
    } finally {
      await page.close();
    }
    // Continuing never rewrote the stored status.
    const after = await admin.request.get(`/api/admissions?search=${encodeURIComponent(PARENT)}`);
    const afterRow = (await after.json()).data.find((r: { id: string }) => r.id === lead.id);
    expect(afterRow).toMatchObject({ status: "VISITED", stage: "FORMULIR_DIKIRIM", payment: "NONE" });
  });

  test("(d) cancelling a lead closes its unpaid payment link", async () => {
    const ip = nextIp();
    const child = `E2E Batal ${STAMP}`;
    const invite = await createInvite(admin.request, { ip, child, email: `e2e-batal-${STAMP}@example.com` });
    // The fee exists only once the form is submitted.
    const submit = await fillAndSubmit(admin.request, { token: invite.token, ip, child, programId: priced.id });
    expect(submit.status()).toBe(201);

    // The link works while the lead is open...
    const pay = await admin.request.post(`/api/enrollments/token/${invite.token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(pay.status()).toBe(200);
    expect(typeof (await pay.json()).paymentUrl).toBe("string");

    // ...and is dead once the lead is cancelled.
    const cancel = await admin.request.put(`/api/admissions/${invite.admissionId}`, { data: { status: "CANCELLED" } });
    expect(cancel.status()).toBe(200);
    const again = await admin.request.post(`/api/enrollments/token/${invite.token}/pay`, { headers: { "X-Forwarded-For": ip } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toBe("APPLICATION_CLOSED");

    // The chase list does not carry a dead row.
    const list = await admin.request.get(`/api/admissions?payment=unpaid&search=${encodeURIComponent(child)}`);
    expect((await list.json()).data.some((r: { id: string }) => r.id === invite.admissionId)).toBe(false);
  });
});
