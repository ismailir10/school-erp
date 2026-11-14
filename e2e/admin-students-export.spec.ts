import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Siswa data export — end-to-end through the admin UI.
 *
 *   1. Open the "Unduh Data" dialog on /admin/students
 *   2. The column picker defaults to all 18 columns selected
 *   3. Deselect the "Wali Murid" group (2 cols) → 16 selected
 *   4. Click "Unduh CSV", capture the download
 *   5. Assert filename `siswa_<date>.csv` and that the CSV header reflects
 *      the column selection (has "Nama Lengkap", omits "Nama Wali")
 *
 * Read-only: triggers a GET export, never mutates data — safe against the
 * shared staging DB. Auth: demo cookie (e2e/admin.spec.ts pattern).
 */

const ADMIN_USER_ID = "u_super_admin";

async function loginAsAdmin(page: Page) {
  await page.context().addCookies([
    {
      name: "school-erp-session",
      value: ADMIN_USER_ID,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Admin students — data export", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("filtered column export downloads a CSV whose header reflects the picker", async ({ page }) => {
    await page.goto("/admin/students");

    await page.getByRole("button", { name: /Unduh Data/ }).click();

    // Scope to the dialog — "Wali Murid" also names the sidebar guardians nav link.
    const dialog = page.getByRole("dialog", { name: "Unduh Data Siswa" });
    await expect(dialog).toBeVisible();
    const downloadBtn = dialog.getByRole("button", { name: /Unduh CSV/ });
    await expect(downloadBtn).toContainText("18 kolom");

    // Drop the "Wali Murid" group (2 columns) → 16 remain.
    await dialog.getByRole("checkbox", { name: "Wali Murid" }).click();
    await expect(downloadBtn).toContainText("16 kolom");

    const downloadPromise = page.waitForEvent("download");
    await downloadBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^siswa_\d{4}-\d{2}-\d{2}\.csv$/);

    const path = await download.path();
    const csv = readFileSync(path, "utf8");
    const header = csv.split("\r\n")[0];
    expect(header).toContain("Nama Lengkap");
    expect(header).not.toContain("Nama Wali");
  });

  test("tapping the Lulus stat card filters the list and shows it pressed", async ({ page }) => {
    await page.goto("/admin/students");
    const lulus = page.getByRole("button", { name: /^Lulus: / });
    await expect(lulus).toHaveAttribute("aria-pressed", "false");
    await lulus.click();
    await expect(lulus).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/status=GRADUATED/);
  });
});
