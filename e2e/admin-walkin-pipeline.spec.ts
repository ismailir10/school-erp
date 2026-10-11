import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  CONSENT_VERSION,
  createInvite,
  newAdminContext,
  newIpBlock,
  postSignature,
  prefillDraft,
} from "./helpers/enrollment";
import { storeLegacyLeadStatus } from "./helpers/legacy-lead";

/**
 * The one Pendaftaran pipeline, lead to student (cycle 2026-10-11-pendaftaran-simplify).
 *
 * Replaces admin-admission-convert-parity: there is a single list (/admin/admissions), a single
 * convert ("Terima & Jadikan Siswa" on the formulir), and the stage of a family is derived.
 *
 *  (a) WALK-IN, no email: Catat Pertanyaan with parent name + phone only → Kirim Formulir with a
 *      priced program → the result card shows the amount → "Tandai lunas (tunai)" → the form link
 *      ("Isi bersama orang tua") opens the real form → the form is filled and submitted →
 *      row "Formulir masuk" + "Lunas" → Ubah data fixes a field → Terima & Jadikan Siswa →
 *      the student and both wali exist, row "Siswa".
 *  (b) PAY FIRST, parent side: with an unpaid fee the link leads to the "Bayar dulu" screen and an
 *      autosave and a submit are refused 409 PAYMENT_REQUIRED; once staff settle it the form opens
 *      with the Program step read-only.
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

function formBody(programId: string, child: string) {
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

type Program = { id: string; name: string; enrollmentFee: number };

test.describe("Pendaftaran pipeline — lead to student", () => {
  let admin: BrowserContext;
  let priced: Program;
  let free: Program;
  let original: Program[] = [];
  let requiredDocuments: string[] = [];

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    const res = await admin.request.get("/api/config/enrollment");
    expect(res.status()).toBe(200);
    const cfg = await res.json();
    requiredDocuments = cfg.requiredDocuments as string[];
    expect(cfg.programs.length).toBeGreaterThan(1);
    priced = cfg.programs[0] as Program;
    free = cfg.programs[1] as Program;
    original = [priced, free].map((p) => ({ ...p }));

    const put = await admin.request.put("/api/config/enrollment", {
      data: {
        requiredDocuments,
        programFees: [
          { programId: priced.id, fee: FEE },
          { programId: free.id, fee: 0 },
        ],
      },
    });
    expect(put.status()).toBe(200);
  });

  test.afterAll(async () => {
    try {
      await admin?.request.put("/api/config/enrollment", {
        data: { requiredDocuments, programFees: original.map((p) => ({ programId: p.id, fee: p.enrollmentFee })) },
      });
    } finally {
      await admin?.close();
    }
  });

  async function searchList(page: Page, text: string) {
    await page.goto("/admin/admissions");
    await page.getByPlaceholder("Cari nama anak atau orang tua...").fill(text);
    return page.getByRole("row").filter({ hasText: text });
  }

  test("(a) walk-in without email: lead → paid in cash → form filled → Ubah data → Terima & Jadikan Siswa", async () => {
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
      await row.getByRole("button", { name: `Kirim Formulir: ${PARENT}` }).click();

      // 3. Kirim Formulir asks for Program (+ Day Care) first and shows the fee as it will be charged.
      const sendDialog = page.locator('[data-slot="dialog-content"]').first();
      await expect(sendDialog.locator('[data-slot="dialog-title"]')).toHaveText("Kirim formulir");
      await sendDialog.locator("#kirim-formulir-program").click();
      await page.getByRole("option", { name: priced.name, exact: true }).click();
      await expect(sendDialog.getByTestId("kirim-formulir-fee")).toContainText("275.000");
      await expect(sendDialog).toContainText("Tidak ada email");
      const invited = page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/enrollments/invite" && res.request().method() === "POST",
      );
      await sendDialog.getByRole("button", { name: "Kirim formulir" }).click();
      const inviteRes = await invited;
      expect(inviteRes.status()).toBe(200);
      const inviteBody = await inviteRes.json();
      expect(inviteBody).toMatchObject({ hasEmail: false, emailed: false, created: true });
      expect(inviteBody.fee).toMatchObject({ status: "UNPAID", amount: FEE });

      // 4. The result card: amount, unpaid; settle it in cash right here.
      const card = page.locator('[data-slot="dialog-content"]').first();
      await expect(card.locator('[data-slot="dialog-title"]')).toHaveText("Formulir siap dikirim");
      const feeLine = card.getByTestId("formulir-fee");
      await expect(feeLine).toContainText("275.000");
      await expect(feeLine).toContainText("Belum bayar");
      await card.getByRole("button", { name: "Tandai lunas (tunai)" }).click();
      await card.getByRole("button", { name: "Tandai lunas", exact: true }).click();
      await expect(feeLine).toContainText("Lunas");
      await expect(feeLine).toContainText("Sudah lunas");

      // 5. "Isi bersama orang tua" is the real parent form, open now that the fee is settled.
      const together = card.getByRole("link", { name: /Isi bersama orang tua/ });
      const formUrl = (await together.getAttribute("href")) ?? "";
      expect(formUrl).toContain("/pendaftaran/");
      const token = formUrl.split("/pendaftaran/")[1];
      const parentCtx = await page.context().browser()!.newContext();
      try {
        const parentPage = await parentCtx.newPage();
        await parentPage.goto(formUrl);
        await expect(parentPage.getByRole("heading", { name: "Formulir Pendaftaran Murid Baru" })).toBeVisible();
      } finally {
        await parentCtx.close();
      }
      await card.getByRole("button", { name: "Selesai" }).click();
      await expect(card).toBeHidden();

      // 6. The form is filled and submitted (token API: the wizard has its own specs).
      const ip = nextIp();
      await prefillDraft(admin.request, { token, ip, child: CHILD, programId: priced.id });
      for (const which of ["ayah", "ibu"] as const) {
        expect((await postSignature(admin.request, { token, ip, which })).status()).toBe(200);
      }
      const submit = await admin.request.post(`/api/enrollments/token/${token}/submit`, {
        headers: { "X-Forwarded-For": ip },
        data: formBody(priced.id, CHILD),
      });
      expect(submit.status()).toBe(201);

      // 7. Same list, same row: "Formulir masuk", paid.
      const submittedRow = await searchList(page, PARENT);
      await expect(submittedRow).toContainText("Formulir masuk");
      await expect(submittedRow).toContainText("Lunas");
      await submittedRow.getByRole("link", { name: /^Buka formulir: / }).click();
      await page.waitForURL(/\/admin\/enrollments\/[^/]+$/);
      const appId = new URL(page.url()).pathname.split("/").pop()!;

      // 8. Ubah data: fix one field, nothing else changes.
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

      // 9. One convert, one confirm.
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

      // 10. The student exists with both wali; the list row now reads "Siswa".
      const student = await (await admin.request.get(`/api/students/${convertBody.student.id}`)).json();
      const relationships = (student.guardians as { relationship: string }[]).map((g) => g.relationship).sort();
      expect(relationships).toEqual(["AYAH", "IBU"]);

      const studentRow = await searchList(page, PARENT);
      await expect(studentRow).toContainText("Siswa");
      await expect(studentRow.getByRole("link", { name: /^Lihat siswa: / })).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test("(b) pay first: the parent meets Bayar dulu, writes are refused, settling opens the form with Program read-only", async ({
    browser,
  }) => {
    const ip = nextIp();
    const child = `E2E Bayar Dulu ${STAMP}`;
    const invite = await createInvite(admin.request, {
      ip,
      child,
      email: `e2e-bayar-dulu-${STAMP}@example.com`,
      programId: priced.id,
      settle: false,
    });
    expect(invite.fee).toMatchObject({ status: "UNPAID", amount: FEE });
    const { token } = invite;

    const parent = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "X-Forwarded-For": ip } });
    try {
      const page = await parent.newPage();

      // The token page leads to the pay screen, not to the form.
      await page.goto(`/pendaftaran/${token}`);
      await expect(page).toHaveURL(new RegExp(`/pendaftaran/${token}/pembayaran`));
      await expect(page.getByRole("heading", { name: "Bayar biaya formulir untuk mulai mengisi" })).toBeVisible();
      await expect(page.getByText("275.000").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Formulir Pendaftaran Murid Baru" })).toHaveCount(0);

      // Every write is refused with the same code.
      const autosave = await parent.request.patch(`/api/enrollments/token/${token}`, {
        data: { studentData: { childName: child } },
      });
      expect(autosave.status()).toBe(409);
      expect((await autosave.json()).error).toBe("PAYMENT_REQUIRED");
      const submit = await parent.request.post(`/api/enrollments/token/${token}/submit`, { data: formBody(priced.id, child) });
      expect(submit.status()).toBe(409);
      expect((await submit.json()).error).toBe("PAYMENT_REQUIRED");

      // Staff settle the fee (the parent paying through the gateway ends the same way).
      const paid = await admin.request.patch(`/api/enrollments/${invite.applicationId}/fee`, {
        data: { action: "MARK_PAID", method: "BANK_TRANSFER", note: "e2e" },
      });
      expect(paid.status()).toBe(200);

      // The open pay screen now leads to the form, and the Program step is read-only.
      await prefillDraft(parent.request, { token, ip, child, programId: free.id });
      await page.goto(`/pendaftaran/${token}`);
      await expect(page.getByRole("list", { name: "Langkah formulir" })).toBeVisible();
      const toDataAnak = page.getByRole("button", { name: "1. Data Anak" });
      if (await toDataAnak.isVisible()) await toDataAnak.click();
      for (const heading of ["Data Anak", "Data Ayah", "Data Ibu", "Pilihan Program"]) {
        if (heading !== "Data Anak") await page.getByRole("button", { name: "Lanjut" }).click();
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }
      await expect(page.getByText("Dipilih saat formulir dikirim.")).toBeVisible();
      await expect(page.getByText(priced.name, { exact: true }).first()).toBeVisible();
      await expect(page.locator('[role="combobox"]')).toHaveCount(0);

      // The draft cannot move the locked program (the save is accepted, the choice is not applied).
      const detail = await (await admin.request.get(`/api/enrollments/${invite.applicationId}`)).json();
      expect(detail.program?.id).toBe(priced.id);
    } finally {
      await parent.close();
    }
  });

  test("(c) legacy: a lead stored as VISITED shows Baru and can be sent a formulir", async () => {
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
      // The primary action is the Baru one, so the family can continue.
      await row.getByRole("button", { name: /^Kirim Formulir: / }).click();
      const dialog = page.locator('[data-slot="dialog-content"]').first();
      await dialog.locator("#kirim-formulir-program").click();
      await page.getByRole("option", { name: free.name, exact: true }).click();
      const invited = page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/enrollments/invite" && res.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Kirim formulir" }).click();
      const res = await invited;
      expect(res.status()).toBe(200);
      expect((await res.json()).fee).toBeNull(); // free program: nothing to pay
      await expect(page.locator('[data-slot="dialog-title"]').first()).toHaveText("Formulir siap dikirim");
      await expect(page.getByTestId("formulir-fee")).toContainText("Tanpa biaya");
      await page.getByRole("button", { name: "Selesai" }).click();

      const sentRow = await searchList(page, PARENT);
      await expect(sentRow).toContainText("Formulir dikirim");
    } finally {
      await page.close();
    }
    // Continuing never rewrote the stored status.
    const after = await admin.request.get(`/api/admissions?search=${encodeURIComponent(PARENT)}`);
    const afterRow = (await after.json()).data.find((r: { id: string }) => r.id === lead.id);
    expect(afterRow).toMatchObject({ status: "VISITED", stage: "FORMULIR_DIKIRIM" });
  });

  test("(d) cancelling a lead closes its unpaid payment link", async () => {
    const ip = nextIp();
    const invite = await createInvite(admin.request, {
      ip,
      child: `E2E Batal ${STAMP}`,
      email: `e2e-batal-${STAMP}@example.com`,
      programId: priced.id,
      settle: false,
    });

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
    const list = await admin.request.get(`/api/admissions?payment=unpaid&search=${encodeURIComponent(`E2E Batal ${STAMP}`)}`);
    expect((await list.json()).data.some((r: { id: string }) => r.id === invite.admissionId)).toBe(false);
  });
});
