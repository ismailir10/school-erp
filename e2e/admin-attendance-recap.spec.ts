import { test, expect } from "@playwright/test";

// E2E coverage for the Rekap Bulanan tab + CSV export on
// /admin/student-attendance (cycle: 2026-06-12-bulk-promotion-attendance-recap).
// Demo-mode session cookie auth matches admin.spec.ts.

const ADMIN_USER_ID = "u_super_admin";

// The current Jakarta month/year — the UI defaults to it, and the API
// assertions below use it so both surfaces exercise the same window.
function jakartaMonthYear(): { month: number; year: number } {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date()); // YYYY-MM-DD
  const [y, m] = ymd.split("-");
  return { month: parseInt(m, 10), year: parseInt(y, 10) };
}

test.describe("Admin /admin/student-attendance — Rekap Bulanan", () => {
  test.beforeEach(async ({ page }) => {
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
  });

  test("Rekap Bulanan tab renders month picker, class filter, and table", async ({
    page,
  }) => {
    await page.goto("/admin/student-attendance");
    await page.waitForURL("**/admin/student-attendance");

    await expect(
      page.getByRole("heading", { name: "Kehadiran Siswa" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("tab", { name: "Rekap Bulanan" }).click();

    // Month input defaults to the current Jakarta month
    const monthInput = page.locator('input[type="month"]');
    await expect(monthInput).toBeVisible();
    const { month, year } = jakartaMonthYear();
    await expect(monthInput).toHaveValue(
      `${year}-${String(month).padStart(2, "0")}`,
    );

    // Table or empty state — both fine on a fresh seed
    const tableOrEmpty = page
      .locator("table")
      .or(page.getByText("Belum ada data rekap"));
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });

    // Export button present (disabled when roster empty, enabled otherwise)
    await expect(
      page.getByRole("button", { name: "Ekspor CSV" }),
    ).toBeVisible();
  });

  test("recap API returns roster rows; export returns CSV with matching header", async ({
    page,
  }) => {
    const { month, year } = jakartaMonthYear();

    const recap = await page.request.get(
      `/api/student-attendance/recap?month=${month}&year=${year}`,
    );
    expect(recap.status()).toBe(200);
    const j = await recap.json();
    expect(Array.isArray(j.data)).toBe(true);
    if (j.data.length > 0) {
      const row = j.data[0];
      for (const k of ["name", "className", "present", "absent", "sick", "permission", "total"]) {
        expect(row).toHaveProperty(k);
      }
    }

    const csv = await page.request.get(
      `/api/student-attendance/export?month=${month}&year=${year}`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("kehadiran_siswa_");
    // The body opens with a UTF-8 BOM so Excel reads accented names correctly.
    const body = await csv.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.slice(1).startsWith("NIS,Nama,Kelas,Hadir,Sakit,Izin,Alpa,Total Hari Tercatat")).toBe(true);
  });

  test("recap API 400s junk month/year instead of returning a misleading 200", async ({
    page,
  }) => {
    for (const qs of ["month=NaN&year=2026", "month=13&year=2026", "month=6&year=junk"]) {
      const res = await page.request.get(`/api/student-attendance/recap?${qs}`);
      expect(res.status(), qs).toBe(400);
    }
  });
});
