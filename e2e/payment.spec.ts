import { test, expect } from "@playwright/test";
import { ensureParentHasInvoice } from "./ensure-parent-invoice";

// /payment/success and /payment/cancel are thin server-side redirect shims
// that forward to /parent/invoices?invoice=<id>&paymentStatus=paid|cancel.
// As of cycle 2026-07-27-doku-payment-gateway (AC-24) the shims emit the
// gateway-neutral `paymentStatus` param instead of the legacy
// `xenditStatus` one — the rename that started with cycle
// 2026-04-27-finance-ui-polish is now generalised across both gateways.
// Return URLs are baked in at session-creation time and live up to 7 days,
// so the parent client (`app/parent/invoices/client.tsx`) must keep
// accepting the legacy `?xenditStatus=` form too, for any Xendit session
// created before this cycle shipped. The destination is auth-gated, so we
// inject the demo session cookie before each test to confirm the redirect
// actually lands on the parent portal.

let parentUserId: string;
let fixtureInvoice: Awaited<ReturnType<typeof ensureParentHasInvoice>>;

test.describe("Payment return shims", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/auth/users");
    const users = await res.json();
    const parent = users.find((u: { role: string }) => u.role === "GUARDIAN");
    if (!parent) throw new Error("No GUARDIAN user found in demo DB");
    parentUserId = parent.id;

    // Own the exact unpaid invoice so unrelated seed/test rows cannot change
    // the status exercised by the legacy callback regression.
    fixtureInvoice = await ensureParentHasInvoice(request, parentUserId);
  });

  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{
      name: "school-erp-session",
      value: parentUserId,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
  });

  test("success shim redirects to /parent/invoices with paid status", async ({ page }) => {
    await page.goto("/payment/success?invoice=demo-fake");
    await page.waitForURL("**/parent/invoices?invoice=demo-fake&paymentStatus=paid", { timeout: 8_000 });
    expect(page.url()).toContain("/parent/invoices?invoice=demo-fake&paymentStatus=paid");
  });

  test("cancel shim redirects to /parent/invoices with cancel status", async ({ page }) => {
    await page.goto("/payment/cancel?invoice=demo-fake");
    await page.waitForURL("**/parent/invoices?invoice=demo-fake&paymentStatus=cancel", { timeout: 8_000 });
    expect(page.url()).toContain("/parent/invoices?invoice=demo-fake&paymentStatus=cancel");
  });

  test("success shim with no invoice param falls back to plain /parent/invoices", async ({ page }) => {
    await page.goto("/payment/success");
    await page.waitForURL("**/parent/invoices", { timeout: 8_000 });
    expect(page.url()).toMatch(/\/parent\/invoices(\?|$)/);
  });

  test("legacy xenditStatus opens the sheet and reflects server payment state (AC-24)", async ({ page }) => {
    // Sessions created before this cycle baked `?xenditStatus=paid|cancel`
    // into their return URL at session-creation time (Xendit links live up
    // to 7 days), so the parent client must keep honouring that param even
    // though the shims above now only ever emit `paymentStatus`. Open our
    // unpaid fixture through the normal UI, then return with a callback that
    // claims paid. Only a real server-side settlement may produce success.
    await page.goto("/parent/invoices");
    await page.waitForURL("**/parent/invoices");

    const rowButton = page
      .locator('ul[aria-label="Tagihan belum dibayar"] button')
      .filter({ hasText: fixtureInvoice.periodLabel });
    await expect(rowButton).toBeVisible({ timeout: 15_000 });

    const [detailResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith(`/api/guardian/invoices/${fixtureInvoice.id}`) && res.request().method() === "GET",
      ),
      rowButton.click(),
    ]);
    expect(detailResponse.ok()).toBeTruthy();
    const invoice = await detailResponse.json() as { id: string; status: string; totalDue: number; totalPaid: number };
    expect(invoice.id).toBe(fixtureInvoice.id);
    expect(["SENT", "OVERDUE"]).toContain(invoice.status);
    expect(invoice.totalPaid).toBe(0);

    // A paid return also asks the server to check the gateway (cycle
    // 2026-10-16-payment-return-check). The demo gateway never reports a
    // settlement, so the invoice must stay unpaid; the response carries only
    // a code and the status, never the admin-voice reconcile message.
    const [checkResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith(`/api/guardian/invoices/${invoice.id}/check-payment`) && res.request().method() === "POST",
      ),
      page.goto(`/parent/invoices?invoice=${invoice.id}&xenditStatus=paid`),
    ]);
    expect(checkResponse.status()).toBe(200);
    const check = await checkResponse.json() as Record<string, unknown>;
    expect(Object.keys(check).sort()).toEqual(["code", "status"]);
    expect(check.code).not.toBe("UPDATED");
    await expect(page.getByText("Pembayaran sedang diperiksa. Status tagihan akan diperbarui setelah dikonfirmasi.")).toBeVisible();
    await expect(page.getByText(/Alhamdulillah/i)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    // The effect strips invoice/xenditStatus via router.replace once it
    // fires — confirms the legacy param was consumed, not just ignored.
    await page.waitForURL((url) => !url.search.includes("xenditStatus"), { timeout: 8_000 });

    // Settle through the real local API, then verify the fresh authoritative
    // state before replaying the same legacy callback.
    const payment = await page.request.post(`/api/invoices/${invoice.id}/payments`, {
      headers: { cookie: "school-erp-session=u_super_admin" },
      data: { amount: invoice.totalDue, method: "CASH" },
    });
    expect(payment.status()).toBe(201);
    const paid = await page.request.get(`/api/guardian/invoices/${invoice.id}`);
    expect(paid.ok()).toBeTruthy();
    expect(await paid.json()).toMatchObject({ status: "PAID", totalPaid: invoice.totalDue });

    await page.goto(`/parent/invoices?invoice=${invoice.id}&xenditStatus=paid`);
    await expect(page.getByText(/Alhamdulillah, tagihan .* terbayar\./)).toBeVisible();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForURL((url) => !url.search.includes("xenditStatus"));
  });
});
