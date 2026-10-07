import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createInvite, firstProgramId, newAdminContext, newIpBlock, prefillDraft } from "./helpers/enrollment";

/**
 * Two parents, two devices, one link.
 *
 * Regression for the 2026-10-06 admissions report: when the parents are in
 * different places and share the /pendaftaran/<token> link, the first parent's
 * signature used to be lost (the token lived only in that browser tab and the
 * draft autosave never persisted it). Now each signature is persisted
 * server-side the moment it is saved, so:
 *   - Parent A signs Ayah's pad on device A,
 *   - Parent B opens the same link on device B and already sees Ayah as saved,
 *   - Parent B signs Ibu's pad,
 *   - Parent A taps "Periksa lagi" (no reload) and sees Ibu as saved, then
 *     submits the form,
 *   - the admin can stream both signature images.
 *
 * The draft is pre-filled through the public PATCH API so the wizard steps
 * validate and the test can focus on the Persetujuan step. Each device is its
 * own browser context (no shared storage/cookies) with its own
 * X-Forwarded-For so the per-IP rate-limit buckets stay apart.
 */

const STAMP = Date.now();
const CHILD = `E2E Handover ${STAMP}`;
const nextIp = newIpBlock(78);

test.describe.configure({ mode: "serial", timeout: 90_000 });

test.describe("Enrollment form — signature handover between two devices", () => {
  let admin: BrowserContext;
  let parentA: BrowserContext;
  let parentB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let token = "";

  test.beforeAll(async ({ browser }) => {
    admin = await newAdminContext(browser);
    const setupIp = nextIp();
    const invite = await createInvite(admin.request, {
      ip: setupIp,
      child: CHILD,
      email: `e2e-handover-${STAMP}@example.com`,
    });
    token = invite.token;
    await prefillDraft(admin.request, {
      token,
      ip: setupIp,
      child: CHILD,
      programId: await firstProgramId(admin.request),
    });

    const viewport = { width: 390, height: 844 };
    parentA = await browser.newContext({ viewport, extraHTTPHeaders: { "X-Forwarded-For": nextIp() } });
    parentB = await browser.newContext({ viewport, extraHTTPHeaders: { "X-Forwarded-For": nextIp() } });
    pageA = await parentA.newPage();
    pageB = await parentB.newPage();
  });

  test.afterAll(async () => {
    await Promise.all([admin?.close(), parentA?.close(), parentB?.close()]);
  });

  /** Open the form and click Lanjut until the Persetujuan step is showing. */
  async function openConsentStep(page: Page) {
    await page.goto(`/pendaftaran/${token}`);
    // A prefilled draft resumes at its first incomplete step (PUBX-4); start
    // the walk from Data Anak through the stepper.
    await expect(page.getByRole("list", { name: "Langkah formulir" })).toBeVisible();
    const toDataAnak = page.getByRole("button", { name: "1. Data Anak" });
    if (await toDataAnak.isVisible()) await toDataAnak.click();
    await expect(page.getByRole("heading", { name: "Data Anak", exact: true })).toBeVisible();
    for (const heading of ["Data Ayah", "Data Ibu", "Pilihan Program", "Berkas pendukung", "Surat Persetujuan Orang Tua"]) {
      await page.getByRole("button", { name: "Lanjut" }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
  }

  /** The card around one signature pad (canvas → wrapper → card). */
  function pad(page: Page, who: "Ayah" | "Ibu"): { canvas: Locator; card: Locator } {
    const canvas = page.getByLabel(new RegExp(`Area tanda tangan.*${who}`, "i"));
    return { canvas, card: canvas.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]") };
  }

  /** Draw a squiggle with the mouse, then press "Simpan tanda tangan". */
  async function signAndSave(page: Page, who: "Ayah" | "Ibu") {
    const { canvas, card } = pad(page, who);
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const { x, y, width, height } = box!;
    await page.mouse.move(x + width * 0.15, y + height * 0.6);
    await page.mouse.down();
    await page.mouse.move(x + width * 0.3, y + height * 0.25, { steps: 6 });
    await page.mouse.move(x + width * 0.5, y + height * 0.75, { steps: 6 });
    await page.mouse.move(x + width * 0.7, y + height * 0.3, { steps: 6 });
    await page.mouse.move(x + width * 0.85, y + height * 0.55, { steps: 6 });
    await page.mouse.up();
    await card.getByRole("button", { name: "Simpan tanda tangan" }).click();
  }

  test("device A signs Ayah and sees the handover note for Ibu", async () => {
    await openConsentStep(pageA);

    // The pre-filled draft ticks the consent box and fills both printed names.
    await expect(pageA.getByLabel("Nama jelas Ayah")).toHaveValue("E2E Ayah");
    await expect(pageA.getByLabel("Nama jelas Ibu")).toHaveValue("E2E Ibu");

    await signAndSave(pageA, "Ayah");
    await expect(pad(pageA, "Ayah").card.getByText("Tersimpan", { exact: true })).toBeVisible();

    await expect(pageA.getByText("Tanda tangan Ibu belum ada")).toBeVisible();
    await expect(pageA.getByRole("button", { name: "Salin link" })).toBeVisible();
    await expect(pageA.getByRole("button", { name: "Periksa lagi" })).toBeVisible();
    // Ibu's pad is still empty.
    await expect(pad(pageA, "Ibu").card.getByText("Tersimpan", { exact: true })).toHaveCount(0);
  });

  test("device B opens the same link and already sees Ayah's signature, then signs Ibu", async () => {
    await openConsentStep(pageB);

    // The regression: nothing was done on B, yet Ayah's signature is there.
    const ayah = pad(pageB, "Ayah").card;
    await expect(ayah.getByText("Tersimpan", { exact: true })).toBeVisible();
    await expect(ayah.getByText("Tanda tangan sudah tersimpan")).toBeVisible();
    await expect(pad(pageB, "Ibu").card.getByText("Tersimpan", { exact: true })).toHaveCount(0);
    await expect(pageB.getByText("Tanda tangan Ibu belum ada")).toBeVisible();

    await signAndSave(pageB, "Ibu");
    await expect(pad(pageB, "Ibu").card.getByText("Tersimpan", { exact: true })).toBeVisible();
    // Both signed on B: no handover note any more, and Ayah's is still there.
    await expect(pageB.getByText(/Tanda tangan (Ayah|Ibu) belum ada/)).toHaveCount(0);
    await expect(ayah.getByText("Tersimpan", { exact: true })).toBeVisible();
  });

  test("device A picks up Ibu's signature without a reload and submits", async () => {
    // Still on A's Persetujuan step, never reloaded since B signed.
    await expect(pageA.getByText("Tanda tangan Ibu belum ada")).toBeVisible();
    await expect(pad(pageA, "Ibu").card.getByText("Tersimpan", { exact: true })).toHaveCount(0);

    await pageA.getByRole("button", { name: "Periksa lagi" }).click();
    await expect(pad(pageA, "Ibu").card.getByText("Tersimpan", { exact: true })).toBeVisible();
    await expect(pageA.getByText(/Tanda tangan (Ayah|Ibu) belum ada/)).toHaveCount(0);

    await pageA.getByRole("button", { name: "Lanjut" }).click();
    await expect(pageA.getByRole("heading", { name: /Tinjau/ })).toBeVisible();
    await expect(pageA.getByText("E2E Ayah").first()).toBeVisible();

    await pageA.getByRole("button", { name: "Kirim Formulir" }).click();
    await expect(pageA.getByText("Jazakumullah khairan")).toBeVisible();
  });

  test("admin can stream both stored signatures of the submitted application", async () => {
    const list = await admin.request.get(
      `/api/enrollments?status=SUBMITTED&search=${encodeURIComponent(CHILD)}&pageSize=20`,
    );
    expect(list.ok()).toBeTruthy();
    const row = (await list.json()).data.find((r: { childName: string }) => r.childName === CHILD);
    expect(row).toBeTruthy();

    for (const which of ["ayah", "ibu"] as const) {
      const sig = await admin.request.get(`/api/enrollments/${row.id}/signature?which=${which}`);
      expect(sig.status()).toBe(200);
      expect(sig.headers()["content-type"]).toContain("image/png");
    }
  });
});
