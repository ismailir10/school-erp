import { test, expect } from "@playwright/test";

// E2E for the C6 parent perkembangan rollup. Discovers the GUARDIAN demo
// user via /api/auth/users (same pattern as e2e/parent.spec.ts) and walks
// the new surface end-to-end.
//
// Coverage:
// 1. The "Perkembangan" entry routes to /parent/perkembangan. As of 2026-08-01 it
//    lives in the bottom nav's "Lainnya" overflow sheet, not as a top-level
//    tab — the 6-tab bar overflowed the 375px viewport (see cycle
//    2026-08-01-parent-nav-mobile-proposal).
// 2. /parent/perkembangan resolves — either auto-redirects to a single
//    kid's detail page or renders the multi-kid list. Both paths land
//    on chrome that contains the perkembangan UI markers.
// 3. /parent/perkembangan/[studentId] renders the 5-row element block
//    (data-testid="perkembangan-elements" with 5 child rows).
// 4. /api/parent/perkembangan/[studentId] returns the design-locked
//    payload shape end-to-end (proves the GUARDIAN auth gate + child
//    scope work against a real session).
//
// The home "Perkembangan minggu ini" card is intentionally skipped —
// the seeded demo DB has no AssessmentEntry rows for this week
// (curriculum weeks are 2025-07..09), so the card's hide-when-empty
// branch fires and there's nothing to assert positively without
// fixture setup.

let parentUserId: string;

test.describe("Parent — Perkembangan (C6)", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/auth/users");
    const users = await res.json();
    const parent = users.find((u: { role: string }) => u.role === "GUARDIAN");
    if (!parent) throw new Error("No GUARDIAN user found in demo DB");
    parentUserId = parent.id;
  });

  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: "school-erp-session",
        value: parentUserId,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("Lainnya sheet exposes the Perkembangan entry pointing to /parent/perkembangan", async ({
    page,
  }) => {
    await page.goto("/parent");
    await page.waitForURL("**/parent", { timeout: 15_000 });

    // Perkembangan is a weekly-cadence surface, so it sits in the overflow sheet
    // rather than owning a permanent slot in the 5-tab bar.
    await expect(
      page.getByRole("navigation", { name: "Navigasi utama orang tua" })
        .getByRole("link", { name: "Perkembangan" }),
    ).toHaveCount(0);

    await page
      .getByRole("navigation", { name: "Navigasi utama orang tua" })
      .getByRole("button", { name: "Lainnya" })
      .click();

    const sheet = page.getByRole("navigation", { name: "Menu lainnya" });
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    const link = sheet.getByRole("link", { name: /Perkembangan/ });
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute("href", /\/parent\/perkembangan/);
  });

  test("/parent/perkembangan resolves to either the list or auto-redirected detail", async ({
    page,
  }) => {
    await page.goto("/parent/perkembangan");
    // Either the list testid OR the detail elements block must appear —
    // single-kid demo will redirect; multi-kid demo will list.
    await expect
      .poll(
        async () => {
          const list = await page
            .locator('[data-testid="perkembangan-children-list"]')
            .count();
          const detail = await page
            .locator('[data-testid="perkembangan-elements"]')
            .count();
          return list + detail;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });

  test("detail page renders the 5-row element progress block", async ({
    page,
  }) => {
    // Resolve studentId independently per test — no cross-test shared state.
    const res = await page.request.get("/api/parent/children");
    const body = await res.json();
    const studentId: string | null = body.data?.[0]?.id ?? null;
    test.skip(
      !studentId,
      "Demo guardian has no children — element-block test cannot run",
    );
    await page.goto(`/parent/perkembangan/${studentId}`);
    await expect(page).toHaveTitle("Perkembangan Anak · Talib");
    const elements = page.locator('[data-testid="perkembangan-elements"] > li');
    await expect(elements).toHaveCount(5, { timeout: 15_000 });
    // Each element row carries a data-testid suffixed with the enum key.
    await expect(
      page.locator('[data-testid="perkembangan-element-RELIGIOUS_MORAL"]'),
    ).toBeVisible();
  });

  test("API returns the design-locked payload for the guardian's child", async ({
    page,
  }) => {
    const childrenRes = await page.request.get("/api/parent/children");
    const childrenBody = await childrenRes.json();
    const id = childrenBody.data?.[0]?.id;
    test.skip(!id, "Demo guardian has no children — API test cannot run");
    const res = await page.request.get(
      `/api/parent/perkembangan/${id}`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.child.id).toBe(id);
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements).toHaveLength(5);
    expect(typeof body.hasActiveWeek).toBe("boolean");
  });

  test("API returns 404 for a studentId that doesn't belong to the guardian", async ({
    page,
  }) => {
    const res = await page.request.get(
      "/api/parent/perkembangan/stu-not-mine",
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Anak tidak ditemukan.");
  });
});
