import { test, expect, type Page } from "@playwright/test";

/**
 * Cycle 2026-10-19-student-detail-clarity: the student page answers first.
 * A child with no class, no photo and no documents shows what needs doing in
 * "Perlu perhatian", the family's WhatsApp / Telepon sit in the first screen,
 * the header offers the one action that fits the child's state, and a deep
 * link into a closed group opens it.
 *
 * Auth: demo cookie school-erp-session=u_super_admin. Isolation: each test
 * creates its own student + wali through the API.
 */

async function loginAsAdmin(page: Page) {
  await page.context().addCookies([
    { name: "school-erp-session", value: "u_super_admin", domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

async function createUnplacedStudent(page: Page) {
  const suffix = Date.now();
  const studentName = `E2E Siswa Perhatian ${suffix}`;
  const waliName = `E2E Wali Siswa ${suffix}`;
  const studentRes = await page.request.post("/api/students", { data: { name: studentName } });
  expect(studentRes.status()).toBe(201);
  const student = (await studentRes.json()) as { id: string };
  const guardianRes = await page.request.post(`/api/students/${student.id}/guardians`, {
    data: { name: waliName, relationship: "IBU", phone: `0812666${String(suffix).slice(-4)}`, isPrimary: true },
  });
  expect(guardianRes.status()).toBe(201);
  return { id: student.id, studentName, waliName };
}

async function archive(page: Page, id: string) {
  await page.request.put(`/api/students/${id}`, { data: { status: "INACTIVE" } }).catch(() => undefined);
}

test.describe("Admin student detail — answers first", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("lists what needs attention, offers the family's WhatsApp, and opens a closed group from a deep link", async ({ page }) => {
    const { id, studentName, waliName } = await createUnplacedStudent(page);
    try {
      await page.goto(`/admin/students/${id}#riwayat-kelas`);
      await expect(page.getByRole("heading", { name: studentName, level: 1 })).toBeVisible({ timeout: 15_000 });

      // Perlu perhatian: no class, and the berkas that are missing, each with a button.
      const strip = page.getByRole("region", { name: "Perlu perhatian" });
      await expect(strip.getByText("Belum terdaftar di kelas")).toBeVisible();
      await expect(strip.getByText(/Berkas belum ada:.*Foto siswa/)).toBeVisible();
      await expect(strip.getByRole("button", { name: "Lengkapi berkas" })).toBeVisible();

      // The family row: wali utama with WhatsApp / Telepon, before any section.
      const family = page.getByRole("region", { name: "Kontak keluarga" });
      await expect(family.getByText(waliName)).toBeVisible();
      await expect(family.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/62/);
      await expect(family.getByRole("link", { name: "Telepon" })).toHaveAttribute("href", /^tel:/);

      // The deep link opened "Kelas & Akademik" (closed by default) down to Riwayat Kelas.
      await expect(page.locator("#group-kelas")).toBeVisible();
      await expect(page.locator("#riwayat-kelas")).toBeVisible();

      // The header offers the one action for an unplaced child: Daftarkan ke Kelas.
      await page.getByRole("button", { name: "Daftarkan ke Kelas" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await archive(page, id);
    }
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("the family's WhatsApp is in the first screen and big enough to tap", async ({ page }) => {
      const { id, studentName } = await createUnplacedStudent(page);
      try {
        await page.goto(`/admin/students/${id}`);
        await expect(page.getByRole("heading", { name: studentName, level: 1 })).toBeVisible({ timeout: 15_000 });

        const whatsapp = page.getByRole("region", { name: "Kontak keluarga" }).getByRole("link", { name: "WhatsApp" });
        await expect(whatsapp).toBeVisible();
        const box = await whatsapp.boundingBox();
        expect(box, "WhatsApp link has a box").not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(43.5);
        expect(box!.y + box!.height, "inside the first 844px screen").toBeLessThanOrEqual(844);

        // Only Profil is open on a phone; the others show their summary.
        await expect(page.locator("#group-kelas [data-slot=\"dossier-summary\"]")).toContainText("Belum terdaftar di kelas");
      } finally {
        await archive(page, id);
      }
    });
  });
});
