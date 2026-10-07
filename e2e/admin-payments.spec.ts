import { test, expect } from "@playwright/test";

// E2E for the Penerimaan payments ledger (/admin/payments) — cycle
// 2026-06-13-payments-ledger. Demo-mode session cookie auth (admin.spec.ts).

const ADMIN_USER_ID = "u_super_admin";

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

test.describe("Admin /admin/payments — Penerimaan ledger", () => {
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

  test("page renders header, summary cards, filters, and table/empty state", async ({ page }) => {
    await page.goto("/admin/payments");
    await page.waitForURL("**/admin/payments");

    await expect(page.getByRole("heading", { name: "Penerimaan" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Total Penerimaan")).toBeVisible();
    await expect(page.getByText("Jumlah Transaksi")).toBeVisible();
    await expect(page.getByLabel("Dari", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ekspor CSV" })).toBeVisible();

    const tableOrEmpty = page.locator("table").or(page.getByText("Belum ada penerimaan"));
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test("ledger API returns data+summary envelope; export returns CSV", async ({ page }) => {
    const today = jakartaToday();

    const ledger = await page.request.get(
      `/api/payments?dateFrom=${today}&dateTo=${today}`,
    );
    expect(ledger.status()).toBe(200);
    const j = await ledger.json();
    expect(Array.isArray(j.data)).toBe(true);
    expect(j.summary).toMatchObject({
      totalAmount: expect.any(Number),
      totalCount: expect.any(Number),
    });
    expect(Array.isArray(j.summary.byMethod)).toBe(true);

    const csv = await page.request.get(
      `/api/payments/export?dateFrom=${today}&dateTo=${today}`,
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("penerimaan_");
    // The body opens with a UTF-8 BOM so Excel reads accented names correctly.
    const body = await csv.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.slice(1).startsWith("Tanggal,Siswa,No. Tagihan,Metode,Referensi,Jumlah")).toBe(true);
  });

  test("ledger API 400s an inverted range and an unknown method", async ({ page }) => {
    const inverted = await page.request.get(
      "/api/payments?dateFrom=2026-06-30&dateTo=2026-06-01",
    );
    expect(inverted.status()).toBe(400);

    const badMethod = await page.request.get("/api/payments?method=BITCOIN");
    expect(badMethod.status()).toBe(400);
  });
});
