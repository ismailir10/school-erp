import { test, expect } from "@playwright/test";
import { ensureParentHasInvoice } from "./ensure-parent-invoice";

// Demo mode E2E — discovers guardian user ID from /api/auth/users and sets
// session cookie directly to avoid rate limit on repeated logins.

let parentUserId: string;

test.describe("Parent flows", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/auth/users");
    const users = await res.json();
    const parent = users.find((u: { role: string }) => u.role === "GUARDIAN");
    if (!parent) throw new Error("No GUARDIAN user found in demo DB");
    parentUserId = parent.id;

    // Own the fixture rather than inheriting it. These specs previously
    // relied on admin.spec's bulk-generate smoke billing every student — see
    // e2e/ensure-parent-invoice.ts for the full story.
    await ensureParentHasInvoice(request, parentUserId);
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
    await page.goto("/parent");
    await page.waitForURL("**/parent", { timeout: 15_000 });
  });

  test("dashboard loads with child info", async ({ page }) => {
    await expect(page.locator("text=Assalamu")).toBeVisible();
    // Dashboard always shows quick-link cards for a logged-in parent with a child
    await expect(page.locator("text=Tagihan").first()).toBeVisible();
  });

  test("home shows household actions and child-specific destinations", async ({ page }) => {
    const childrenResponse = await page.request.get("/api/parent/children");
    expect(childrenResponse.ok()).toBe(true);
    const { data: children } = await childrenResponse.json() as {
      data: Array<{ id: string; name: string }>;
    };
    expect(children.length).toBeGreaterThan(0);

    await expect(page.getByRole("heading", { level: 1, name: "Kabar keluarga hari ini" })).toBeVisible();
    const household = page.getByRole("region", { name: "Hari ini", exact: true });
    await expect(household).toBeVisible();
    await expect(household.getByText("Tagihan keluarga", { exact: true }).or(household.getByText("Lunas semua", { exact: true }))).toBeVisible();

    // The immediate bill action must identify an authorized child and keep that
    // child's context. Other children's bills can remain progressively disclosed.
    if (await household.getByText("Tagihan keluarga", { exact: true }).isVisible()) {
      const billAction = household.getByRole("link", { name: /^Tagihan / }).first();
      await expect(billAction).toBeVisible();
      const destination = new URL((await billAction.getAttribute("href"))!, page.url());
      expect(destination.pathname).toBe("/parent/invoices");
      const child = children.find((item) => item.id === destination.searchParams.get("child"));
      expect(child).toBeDefined();
      await expect(billAction).toContainText(`Tagihan ${child!.name}`);
    }

    await expect(page.getByText("Anak saya", { exact: true })).toBeVisible();
    for (const child of children) {
      const card = page.locator('[data-slot="card"]').filter({
        has: page.getByRole("heading", { level: 3, name: child.name, exact: true }),
      });
      await expect(card).toBeVisible();
      const destinations = [
        ["Baca catatan", "/parent/student-journal"],
        ["Lihat kehadiran", "/parent/attendance"],
        ["Rapor", "/parent/reports"],
        ["Tagihan", "/parent/invoices"],
      ];
      for (const [label, pathname] of destinations) {
        const link = card.getByRole("link", { name: label, exact: true });
        await expect(link).toBeVisible();
        const destination = new URL((await link.getAttribute("href"))!, page.url());
        expect(destination.pathname).toBe(pathname);
        expect(destination.searchParams.get("child")).toBe(child.id);
        if (label === "Baca catatan") expect(destination.searchParams.get("view")).toBe("notes");
      }
      await expect(card.getByRole("link", { name: "Perkembangan", exact: true })).toHaveAttribute("href", `/parent/perkembangan/${child.id}`);
    }
  });

  test("invoices page loads", async ({ page }) => {
    await page.goto("/parent/invoices");
    await page.waitForURL("**/parent/invoices");
    // Cycle-4: PageHeader h1 = "Tagihan" (was "Tagihan Saya" in cycle-3).
    await expect(page.getByRole("heading", { level: 1, name: "Tagihan" })).toBeVisible();
    // Either the focal due card with "tagihan" caption or the celebration card.
    await expect(
      page.locator("text=Lunas semua")
        .or(page.getByText(/tagihan/i))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("attendance page loads", async ({ page }) => {
    await page.goto("/parent/attendance");
    await page.waitForURL("**/parent/attendance");
    // Cycle-4: PageHeader h1 = "Kehadiran" + subtitle.
    await expect(page.getByRole("heading", { level: 1, name: "Kehadiran" })).toBeVisible();
    // Either the week grid renders, the empty-state, or the legacy strip — broad acceptance.
    await expect(
      page.locator("text=Pekan ini belum dimulai")
        .or(page.locator("text=Belum ada catatan kehadiran"))
        // The status row is labelled "Status" (X-13): it holds ✓/S/I/A.
        .or(page.getByRole("cell", { name: /^Status$/ }))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("reports page loads", async ({ page }) => {
    await page.goto("/parent/reports");
    await page.waitForURL("**/parent/reports");
    // Cycle-4: PageHeader h1 = "Rapor".
    await expect(page.getByRole("heading", { level: 1, name: "Rapor" })).toBeVisible();
    // Either celebration card OR empty state.
    await expect(
      page.locator("text=Rapor belum terbit")
        .or(page.getByRole("button", { name: /Buka rapor/ }))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("home and /parent/invoices agree on outstanding (UAT-2026-05-03 INV-01)", async ({ page }) => {
    // Wait for the home signal surface to render before probing — without
    // this gate the .isVisible() check below resolves false on cold paint
    // and the count scrape silently skips, producing a vacuous green that
    // defeats the regression guard.
    await expect(
      page
        .getByText(/Lunas semua/i)
        .or(page.getByText(/tagihan belum dibayar/))
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // Capture home Tagihan state. Two render branches:
    //   (a) outstanding > 0   → text "{N} tagihan belum dibayar"
    //   (b) outstanding === 0 → text "Lunas semua" (under "Pekan ini" eyebrow)
    const lunasOnHome = await page
      .getByText(/Lunas semua/i)
      .first()
      .isVisible()
      .catch(() => false);

    let homeCount: number | null = null;
    if (!lunasOnHome) {
      // Read "{N} tagihan belum dibayar". The N is the household-aggregate
      // count produced by getParentOutstandingForStudents.
      const countText = await page
        .getByText(/(\d+)\s+tagihan belum dibayar/)
        .first()
        .textContent({ timeout: 5_000 });
      const match = countText?.match(/(\d+)\s+tagihan belum dibayar/);
      if (match) homeCount = Number(match[1]);
    }

    // Navigate to /parent/invoices (default child — first one).
    await page.goto("/parent/invoices");
    await page.waitForURL("**/parent/invoices");

    if (lunasOnHome) {
      // Home said no outstanding → list MUST also say "Lunas semua".
      await expect(page.getByText(/Lunas semua/i).first()).toBeVisible({
        timeout: 10_000,
      });
    } else {
      expect(homeCount).not.toBeNull();
      // List MUST NOT say "Lunas semua" outright when household has outstanding.
      // Acceptable banners on the list (with default child selected):
      //   - "Belum dibayar" header (selected child has outstanding too)
      //   - "Lunas untuk {name}" with a sibling-switcher row (selected paid, sibling owes)
      // Either is correct; "Lunas semua" alone is the bug we are guarding.
      const lunasUntuk = page.getByText(/Lunas untuk/i).first();
      const belumDibayar = page.getByText(/Belum dibayar/i).first();
      await expect(lunasUntuk.or(belumDibayar)).toBeVisible({ timeout: 10_000 });

      const naiveLunasSemua = page.getByText(/^Lunas semua$/);
      // Strict-mode locator that targets ONLY the standalone celebration card,
      // not the substring inside "Lunas untuk {name}". If naive is visible
      // alongside outstanding household, the bug regressed.
      const naiveCount = await naiveLunasSemua.count();
      expect(
        naiveCount,
        `home shows ${homeCount} unpaid but list renders standalone "Lunas semua"`,
      ).toBe(0);
    }
  });

  test("logout works", async ({ page }) => {
    // UAT 2026-05-12 — logout now opens a ConfirmDialog before signing out.
    await page.click("[aria-label='Keluar']");
    await page.getByRole("button", { name: "Keluar dari akun", exact: true }).click();
    await page.waitForURL("/", { timeout: 10_000 });
    // Use first() — "An Nisaa" appears multiple times on login page
    await expect(page.locator("text=An Nisaa").first()).toBeVisible();
  });

  test("parent can open Jurnal tab with Di Sekolah/Di Rumah/Catatan tabs", async ({ page }) => {
    await page.goto("/parent/student-journal");
    await page.waitForURL("**/parent/student-journal", { timeout: 15_000 });
    // Page heading always renders regardless of whether the guardian has a child.
    // Parent-facing label is "Jurnal" (the bottom-nav tab has to match, and
    // "Penghubung" does not fit a 5-tab bar at 375px). The route slug is still
    // /parent/student-journal — the rename is copy-only.
    await expect(
      page
        .getByRole("heading", { name: /^Jurnal$/ })
        .or(page.getByText(/Belum ada data anak/))
    ).toBeVisible({ timeout: 10_000 });
    // If week data loads the tabs appear — conditional check (empty DB is fine)
    const schoolTab = page.getByRole("tab", { name: /Di Sekolah/i });
    const hasData = await schoolTab.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasData) {
      await expect(page.getByRole("tab", { name: /Di Sekolah/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Di Rumah/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Catatan/i })).toBeVisible();
    }
  });

  // ── Bottom nav (fixed 2026-08-01) ──────────────────────────────────
  // The bar had drifted to 6 tabs; at 375px the last slot rendered 27.4px past
  // the viewport and at 360px it did not render at all. These tests pin the
  // 5-slot ceiling and prove nothing is clipped at either width.
  test("bottom nav shows 5 slots and nothing is clipped at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/parent");
    await page.waitForURL("**/parent", { timeout: 15_000 });

    const nav = page.getByRole("navigation", { name: "Navigasi utama orang tua" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.getByRole("button", { name: "Lainnya" })).toBeVisible();

    for (const label of ["Beranda", "Tagihan", "Kehadiran", "Jurnal"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    // Every slot must sit fully inside the viewport.
    const viewport = page.viewportSize()!.width;
    const slots = await nav.locator("a, button").all();
    for (const slot of slots) {
      const box = await slot.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport + 0.5);
      // Tap target minimum.
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("bottom nav is fully visible at 360px too", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/parent");
    await page.waitForURL("**/parent", { timeout: 15_000 });

    const nav = page.getByRole("navigation", { name: "Navigasi utama orang tua" });
    const viewport = 360;
    const slots = await nav.locator("a, button").all();
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      const box = await slot.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport + 0.5);
    }
  });

  test("Lainnya opens the overflow sheet and navigates to Rapor", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/parent");
    await page.waitForURL("**/parent", { timeout: 15_000 });

    // CSS locator, not getByRole: while the drawer is open it is modal, so the
    // bar behind it is removed from the accessibility tree and a role query for
    // the trigger finds nothing. That is correct modal behaviour — assert the
    // attribute through the DOM instead.
    const trigger = page.locator(
      'nav[aria-label="Navigasi utama orang tua"] button:has-text("Lainnya")',
    );
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const sheet = page.getByRole("navigation", { name: "Menu lainnya" });
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const label of ["Perkembangan", "Rapor", "Profil"]) {
      await expect(sheet.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    }

    const reportLink = sheet.getByRole("link", { name: /Rapor/ });
    const href = await reportLink.getAttribute("href");
    expect(href).toBeTruthy();
    const childId = new URL(href!, page.url()).searchParams.get("child");
    expect(childId).toBeTruthy();
    await reportLink.click();
    await page.waitForURL((url) =>
      url.pathname === "/parent/reports" && url.searchParams.get("child") === childId,
    );
    await expect(page.getByRole("heading", { level: 1, name: "Rapor" })).toBeVisible();
  });
});
