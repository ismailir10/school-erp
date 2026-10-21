import { test, expect } from "@playwright/test";

const SUPER_ADMIN_USER_ID = "u_super_admin";
const SCHOOL_ADMIN_USER_ID = "u_school_admin";

type DemoUser = {
  id: string;
  role: string;
};

let superAdminUserId = SUPER_ADMIN_USER_ID;
let schoolAdminUserId = SCHOOL_ADMIN_USER_ID;

async function loginAs(page: import("@playwright/test").Page, userId: string) {
  await page.context().addCookies([{
    name: "school-erp-session",
    value: userId,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

test.beforeAll(async ({ request }) => {
  const res = await request.get("/api/auth/users");
  expect(res.ok()).toBeTruthy();

  const users = (await res.json()) as DemoUser[];
  const superAdmin =
    users.find((user) => user.id === SUPER_ADMIN_USER_ID) ??
    users.find((user) => user.role === "SUPER_ADMIN");
  const schoolAdmin =
    users.find((user) => user.id === SCHOOL_ADMIN_USER_ID) ??
    users.find((user) => user.role === "SCHOOL_ADMIN");

  expect(superAdmin, "SUPER_ADMIN demo user required").toBeTruthy();
  expect(schoolAdmin, "SCHOOL_ADMIN demo user required").toBeTruthy();

  superAdminUserId = superAdmin!.id;
  schoolAdminUserId = schoolAdmin!.id;
});

test.describe("admin dashboard rebuild — SUPER_ADMIN", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, superAdminUserId);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  });

  test("action region fits the first 1440x900 screen; Analitik follows below", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Let queue tiles / urgent list / attendance strip finish rendering
    // before measuring — the page is server-rendered so this is mostly a
    // safety margin for fonts/webfont reflow.
    await expect(page.getByTestId("dashboard-queue-tiles")).toBeVisible();
    const region = await page.getByTestId("dashboard-action-region").boundingBox();
    expect(region).not.toBeNull();
    expect(region!.y + region!.height).toBeLessThanOrEqual(900 + 1);
    // The streamed Analitik section starts below the action region.
    const analytics = page.getByTestId("dashboard-analytics");
    await expect(analytics).toBeAttached({ timeout: 15_000 });
    const analyticsBox = await analytics.boundingBox();
    expect(analyticsBox!.y).toBeGreaterThanOrEqual(region!.y + region!.height);
  });

  test("Analitik shows the headline numbers and every card as a chart or an empty state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const analytics = page.getByTestId("dashboard-analytics");
    await analytics.scrollIntoViewIfNeeded();
    await expect(analytics.getByRole("heading", { name: "Analitik" })).toBeVisible();

    const headline = analytics.getByTestId("analytics-headline");
    await expect(headline).toBeVisible();
    await expect(headline.getByRole("link")).toHaveCount(3);
    await expect(headline.locator('a[href="/admin/student-attendance"]')).toBeVisible();
    await expect(headline.locator('a[href="/admin/invoices"]')).toBeVisible();
    await expect(headline.locator('a[href="/admin/student-journal/monitoring"]')).toBeVisible();

    for (const id of ["analytics-attendance", "analytics-journal", "analytics-finance-trend"]) {
      const card = analytics.getByTestId(id);
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('[data-slot="chart"]').or(card.getByText(/^Belum ada/)).first()).toBeVisible();
    }
    const aging = analytics.getByTestId("analytics-aging");
    await aging.scrollIntoViewIfNeeded();
    await expect(aging.getByText("> 90 hari").or(aging.getByText("Tidak ada piutang")).first()).toBeVisible();
  });

  test("Analitik is visible without motion under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    const headline = page.getByTestId("analytics-headline");
    await headline.scrollIntoViewIfNeeded();
    await expect(headline).toBeVisible();
    // Nothing is held at opacity 0 waiting for a reveal.
    const opacity = await headline.evaluate((el) => {
      let node: Element | null = el;
      let min = 1;
      while (node) { min = Math.min(min, Number(getComputedStyle(node).opacity)); node = node.parentElement; }
      return min;
    });
    expect(opacity).toBe(1);
  });

  test("renders queue summary tiles linking into the work queue by kind", async ({ page }) => {
    const tiles = page.getByTestId("dashboard-queue-tiles");
    await expect(tiles).toBeVisible();
    const invoiceTile = tiles.locator('a[href="/admin/work-queue?kind=invoice"]');
    if (await invoiceTile.count()) {
      await invoiceTile.first().click();
      await expect(page).toHaveURL(/\/admin\/work-queue\?kind=invoice/);
      await expect(page.getByTestId("admin-work-queue")).toBeVisible();
    }
  });

  test("renders the urgent list (top items) or nothing when the queue is empty", async ({ page }) => {
    const urgentList = page.getByTestId("dashboard-urgent-list");
    // The urgent list unmounts entirely when the queue total is 0 — either
    // state is valid, so only assert the invariant: if present, it links to
    // the full queue with a real count.
    if (await urgentList.count()) {
      await expect(urgentList).toBeVisible();
      await expect(urgentList.getByRole("link", { name: /Lihat semua \(\d+\)/ })).toHaveAttribute("href", "/admin/work-queue");
    }
  });

  test("renders the attendance strip linking to employee-attendance", async ({ page }) => {
    const strip = page.getByTestId("dashboard-attendance-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("link", { name: /Lihat kehadiran/ })).toHaveAttribute("href", "/admin/employee-attendance");
  });

  test("renders actionable leave and admission records in the work queue table", async ({ page }) => {
    await page.goto("/admin/work-queue");
    const queue = page.getByTestId("admin-work-queue");
    await expect(queue).toBeVisible();
    const [leaveResponse, enrollmentResponse] = await Promise.all([
      page.request.get("/api/leave/requests?status=PENDING&pageSize=100"),
      page.request.get("/api/enrollments?pageSize=100"),
    ]);
    expect(leaveResponse.ok()).toBeTruthy();
    expect(enrollmentResponse.ok()).toBeTruthy();
    const leaveBody = await leaveResponse.json() as { data: Array<{ id: string; employee: { nama: string } }>; capabilities: { approve: boolean } };
    const enrollmentBody = await enrollmentResponse.json() as { data: Array<{ id: string; childName: string; studentId: string | null; status: string }> };
    expect(leaveBody.capabilities.approve).toBe(true);

    const pendingLeave = leaveBody.data[0];
    if (pendingLeave) {
      await queue.getByRole("textbox", { name: "Cari pekerjaan, nama, atau nomor…" }).fill(pendingLeave.employee.nama);
      await expect(queue.locator(`a[href="/admin/leave-requests?requestId=${pendingLeave.id}"]`)).toBeVisible();
      await queue.getByRole("textbox", { name: "Cari pekerjaan, nama, atau nomor…" }).fill("");
    }
    const pendingForm = enrollmentBody.data.find(row => !row.studentId && ["SUBMITTED", "UNDER_REVIEW"].includes(row.status));
    if (pendingForm) {
      await queue.getByRole("textbox", { name: "Cari pekerjaan, nama, atau nomor…" }).fill(pendingForm.childName);
      await expect(queue.locator(`a[href="/admin/enrollments/${pendingForm.id}"]`)).toBeVisible();
    }
  });

  test("work queue supports filtering by kind via ?kind= and keeps leave/payroll distinct", async ({ page }) => {
    await page.goto("/admin/work-queue?kind=payroll");
    const queue = page.getByTestId("admin-work-queue");
    await expect(queue).toBeVisible();
    await expect(queue.locator('a[href^="/admin/leave-requests?requestId="]')).toHaveCount(0);
  });

  test("renders the 7-day attendance trend chart on the employee-attendance page (not the dashboard)", async ({ page }) => {
    await page.goto("/admin/employee-attendance");
    await expect(page.getByText("Tren Kehadiran")).toBeVisible();
    await expect(page.getByText("7 hari kerja terakhir")).toBeVisible();
    const chartEl = page.locator('[data-slot="chart"]');
    const emptyEl = page.getByText("Data kehadiran belum tersedia");
    const chartOrEmpty = chartEl.or(emptyEl).first();
    await expect(chartOrEmpty).toBeVisible();
    // The dashboard-only "Lihat detail" link is dropped on its own page.
    await expect(page.getByRole("link", { name: "Lihat detail" })).toHaveCount(0);
  });

  test("dashboard right rail shows recent activity at xl width only", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const avatarEl = page.locator('[data-slot="avatar"]');
    const emptyEl = page.getByText("Belum ada aktivitas hari ini");
    const feedOrEmpty = avatarEl.or(emptyEl).first();
    await expect(feedOrEmpty).toBeVisible();
  });
});

test.describe("admin dashboard rebuild — SCHOOL_ADMIN gating", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, schoolAdminUserId);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  });

  test("Analitik follows the role's finance permission", async ({ page }) => {
    const analytics = page.getByTestId("dashboard-analytics");
    await analytics.scrollIntoViewIfNeeded();
    await expect(analytics.getByTestId("analytics-attendance")).toBeVisible();
    await expect(analytics.getByTestId("analytics-journal")).toBeVisible();
    const canSeeInvoices = (await page.request.get("/api/invoices?pageSize=1")).status() === 200;
    await expect(analytics.getByTestId("analytics-finance-trend")).toHaveCount(canSeeInvoices ? 1 : 0);
    await expect(analytics.getByTestId("analytics-aging")).toHaveCount(canSeeInvoices ? 1 : 0);
  });

  test("keeps payroll records out of the authorized work queue", async ({ page }) => {
    const tiles = page.getByTestId("dashboard-queue-tiles");
    await expect(tiles).toBeVisible();
    await expect(tiles.locator('a[href="/admin/work-queue?kind=payroll"]')).toHaveCount(0);
    expect((await page.request.get("/api/payroll")).status()).toBe(403);

    await page.goto("/admin/work-queue");
    const queue = page.getByTestId("admin-work-queue");
    await expect(queue).toBeVisible();
    expect((await page.request.get("/api/enrollments?pageSize=1")).status()).toBe(200);
    await expect(queue.locator('a[href^="/admin/payroll/"]')).toHaveCount(0);
  });

  test("keeps leave decisions out of the authorized work queue", async ({ page }) => {
    const tiles = page.getByTestId("dashboard-queue-tiles");
    await expect(tiles).toBeVisible();
    await expect(tiles.locator('a[href="/admin/work-queue?kind=leave"]')).toHaveCount(0);
    expect((await page.request.get("/api/leave/requests")).status()).toBe(403);

    await page.goto("/admin/work-queue");
    const queue = page.getByTestId("admin-work-queue");
    await expect(queue).toBeVisible();
    expect((await page.request.get("/api/invoices?pageSize=1")).status()).toBe(200);
    await expect(queue.locator('a[href^="/admin/leave-requests?requestId="]')).toHaveCount(0);
  });
});
