import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  createInvite,
  firstProgramId,
  newAdminContext,
  newIpBlock,
  postSignature,
  prefillDraft,
  tinyPdf,
} from "./helpers/enrollment";

/**
 * Kelengkapan Berkas — parent upload on the form + staff checklist.
 *
 * Parent side (real browser): on the "Berkas" step upload Kartu Keluarga via
 * the file input, see the file name, remove it, upload it again, then see the
 * still-missing documents on the Tinjau step and submit. Uploads are real: the
 * server runs the demo disk storage backend under DEMO_MODE.
 *
 * Admin side (real browser): the submitted application shows the
 * "Kelengkapan Berkas" card — KK as "Diunggah", and staff can tick "Diterima
 * fisik" for another item, which moves the progress counter and persists.
 *
 * The two signatures are posted through the API beforehand (the signature pad
 * itself is covered by enrollment-signature-handover.spec.ts) and the draft is
 * pre-filled through the public PATCH, so the wizard only needs "Lanjut".
 */

const STAMP = Date.now();
const CHILD = `E2E Berkas ${STAMP}`;
const FILE_NAME = "kk-scan.pdf";
const KK_LABEL = "Kartu Keluarga (KK)";
const AKTA_LABEL = "Akta kelahiran anak";
const nextIp = newIpBlock(79);

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("Enrollment form — Kelengkapan Berkas upload and staff checklist", () => {
  let admin: BrowserContext;
  let parent: BrowserContext;
  let parentPage: Page;
  let token = "";
  let appId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    const ip = nextIp();
    const invite = await createInvite(admin.request, { ip, child: CHILD, email: `e2e-berkas-${STAMP}@example.com` });
    token = invite.token;
    await prefillDraft(admin.request, { token, ip, child: CHILD, programId: await firstProgramId(admin.request) });
    for (const which of ["ayah", "ibu"] as const) {
      const sig = await postSignature(admin.request, { token, ip, which });
      expect(sig.status()).toBe(200);
    }

    parent = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": nextIp() } });
    parentPage = await parent.newPage();
  });

  test.afterAll(async () => {
    await Promise.all([admin?.close(), parent?.close()]);
  });

  async function uploadKk(page: Page) {
    // The file input is visually hidden; its id is `berkas-<key>`.
    await page.locator("#berkas-kk").setInputFiles({
      name: FILE_NAME,
      mimeType: "application/pdf",
      buffer: tinyPdf("kk"),
    });
    await expect(page.getByText(FILE_NAME)).toBeVisible();
  }

  test("parent uploads, removes and re-uploads a document, then submits with the rest missing", async () => {
    const page = parentPage;
    await page.goto(`/pendaftaran/${token}`);
    await expect(page.getByRole("heading", { name: "Data Anak", exact: true })).toBeVisible();
    for (const heading of ["Data Ayah", "Data Ibu", "Pilihan Program", "Berkas pendukung"]) {
      await page.getByRole("button", { name: "Lanjut" }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    // Nothing uploaded yet.
    await expect(page.getByRole("button", { name: `Unggah ${KK_LABEL}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Hapus ${KK_LABEL}` })).toHaveCount(0);

    // Upload → file name shown with Ganti / Hapus.
    await uploadKk(page);
    await expect(page.getByRole("button", { name: `Hapus ${KK_LABEL}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Ganti ${KK_LABEL}` })).toBeVisible();

    // Remove asks first (destructive AlertDialog); cancel keeps the file.
    await page.getByRole("button", { name: `Hapus ${KK_LABEL}` }).click();
    const confirm = page.getByRole("alertdialog", { name: "Hapus berkas ini?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByText(FILE_NAME)).toBeVisible();

    // Confirm → gone, back to Unggah.
    await page.getByRole("button", { name: `Hapus ${KK_LABEL}` }).click();
    await page.getByRole("alertdialog", { name: "Hapus berkas ini?" }).getByRole("button", { name: "Hapus" }).click();
    await expect(page.getByText(FILE_NAME)).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Unggah ${KK_LABEL}` })).toBeVisible();

    // Upload again.
    await uploadKk(page);

    // Berkas is optional: Lanjut through Persetujuan (signed + consent already
    // on the row) to Tinjau, which lists what is still missing.
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByRole("heading", { name: "Surat Persetujuan Orang Tua", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.getByRole("heading", { name: /Tinjau/ })).toBeVisible();

    const missing = page.getByText(/mohon dibawa ke sekolah/).first();
    await expect(missing).toBeVisible();
    await expect(missing).toContainText(AKTA_LABEL);
    await expect(missing).not.toContainText(KK_LABEL);

    await page.getByRole("button", { name: "Kirim Formulir" }).click();
    await expect(page.getByText("Jazakumullah khairan")).toBeVisible();
    await expect(page.getByText("Berkas yang perlu dibawa ke sekolah")).toBeVisible();
  });

  test("admin sees Kelengkapan Berkas: KK uploaded, ticks another item received", async () => {
    const list = await admin.request.get(
      `/api/enrollments?status=SUBMITTED&search=${encodeURIComponent(CHILD)}&pageSize=20`,
    );
    expect(list.ok()).toBeTruthy();
    const row = (await list.json()).data.find((r: { childName: string }) => r.childName === CHILD);
    expect(row).toBeTruthy();
    appId = row.id as string;

    const page = await admin.newPage();
    await page.goto(`/admin/enrollments/${appId}`);

    const card = page.getByRole("region", { name: "Kelengkapan Berkas" });
    await expect(card).toBeVisible();
    await expect(card.getByText("1 / 9 berkas lengkap")).toBeVisible();

    // KK: uploaded by the parent, viewable through the admin-gated stream route.
    const kkRow = card.getByRole("listitem").filter({ hasText: KK_LABEL });
    await expect(kkRow.getByText("Diunggah", { exact: true })).toBeVisible();
    await expect(kkRow.getByText(FILE_NAME)).toBeVisible();
    await expect(kkRow.getByRole("link", { name: `Lihat ${KK_LABEL}` })).toHaveAttribute(
      "href",
      `/api/enrollments/${appId}/documents/kk`,
    );

    // Akta: not uploaded; staff received it on paper.
    const aktaRow = card.getByRole("listitem").filter({ hasText: AKTA_LABEL });
    await expect(aktaRow.getByText("Belum", { exact: true })).toBeVisible();
    const aktaTick = card.getByRole("checkbox", { name: `Diterima fisik: ${AKTA_LABEL}` });
    await expect(aktaTick).not.toBeChecked();
    await aktaTick.check();
    await expect(card.getByText("2 / 9 berkas lengkap")).toBeVisible();

    // Persisted server-side, not just optimistic UI state.
    await page.reload();
    const reloaded = page.getByRole("region", { name: "Kelengkapan Berkas" });
    await expect(reloaded.getByText("2 / 9 berkas lengkap")).toBeVisible();
    await expect(reloaded.getByRole("checkbox", { name: `Diterima fisik: ${AKTA_LABEL}` })).toBeChecked();
    await page.close();
  });
});
