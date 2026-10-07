import { test, expect } from "@playwright/test";

// Regression guard for UAT 2026-05-03 BLOCKER U6 (sign-out bfcache leak).
// After signing out from /parent/home, the browser back-button must not
// restore the cached parent page from bfcache (privacy: prior user's
// children, invoices, reports must not be visible without re-auth).
//
// Why this is a Cache-Control HEADER assertion, not a `page.goBack()`
// assertion: Playwright Chromium does not reliably exercise the
// back/forward cache. `page.goBack()` typically issues a fresh navigation
// rather than restoring from bfcache, so a "log in → log out → goBack →
// expect login" flow passes whether or not Cache-Control: no-store is
// set, making it useless as a regression guard.
//
// Chrome's bfcache disqualification rule
// (`MainResourceHasCacheControlNoStore`) is keyed off the response
// header itself, so asserting the header gives a true regression guard:
// the OS-level bfcache eviction will follow as long as the header is
// present.
//
// Acceptance:
//   - Portal HTML responses (/admin, /parent, /teacher and a sub-route
//     of each) carry Cache-Control containing no-store, no-cache,
//     must-revalidate, AND private.
//   - POST /api/auth/logout response carries Cache-Control containing
//     no-store, no-cache, AND must-revalidate.

const ADMIN_USER_ID = "u_super_admin";

let guardianUserId: string;
let teacherUserId: string;

test.describe("Sign-out bfcache header guard (UAT U6 — 2026-05-03)", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/auth/users");
    const users = (await res.json()) as Array<{ id: string; role: string }>;
    const guardian = users.find((u) => u.role === "GUARDIAN");
    const teacher = users.find((u) => u.role === "TEACHER");
    if (!guardian) throw new Error("No GUARDIAN user found in demo DB");
    if (!teacher) throw new Error("No TEACHER user found in demo DB");
    guardianUserId = guardian.id;
    teacherUserId = teacher.id;
  });

  for (const role of ["admin", "parent", "teacher"] as const) {
    test(`portal HTML response under ${role} carries Cache-Control: no-store`, async ({
      page,
    }) => {
      const userId =
        role === "admin"
          ? ADMIN_USER_ID
          : role === "parent"
            ? guardianUserId
            : teacherUserId;
      await page.context().addCookies([
        {
          name: "school-erp-session",
          value: userId,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);

      const root = `/${role === "admin" ? "admin" : role}`;
      const res = await page.request.fetch(root, {
        maxRedirects: 0,
      });
      const cc = res.headers()["cache-control"] ?? "";
      expect(cc, `Cache-Control on ${root}`).toContain("no-store");
      expect(cc, `Cache-Control on ${root}`).toContain("no-cache");
      expect(cc, `Cache-Control on ${root}`).toContain("must-revalidate");
      expect(cc, `Cache-Control on ${root}`).toContain("private");
    });
  }

  test("POST /api/auth/logout response carries explicit Cache-Control: no-store", async ({
    page,
  }) => {
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
    const res = await page.request.post("/api/auth/logout");
    expect(res.status()).toBe(200);
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc, "Cache-Control on /api/auth/logout").toContain("no-store");
    expect(cc, "Cache-Control on /api/auth/logout").toContain("no-cache");
    expect(cc, "Cache-Control on /api/auth/logout").toContain("must-revalidate");
    expect(res.headers()["pragma"]).toBe("no-cache");
    expect(res.headers()["expires"]).toBe("0");
  });
});

// PAR-1 (2026-09-29 full E2E): after Keluar the app used router.push("/"), so
// browser Back re-rendered the signed-in /parent/profile (name, phone, email,
// children) from Next's CLIENT router cache with zero server requests — the
// Cache-Control assertions above cannot see that. Sign-out now ends in a full
// document navigation (window.location.replace), so Back must reach the server
// and land on the login page.
//
// History for each test: [/parent (document load), /parent/profile (client
// navigation)]. Before the fix Keluar pushed "/", making Back return to the
// cached profile. After it, "/" replaces the profile entry and Back hits
// /parent, which redirects a signed-out visitor to "/".
test.describe("Back after sign-out does not restore the signed-in page (PAR-1)", () => {
  test.beforeAll(async ({ request }) => {
    const users = (await (await request.get("/api/auth/users")).json()) as Array<{ id: string; role: string }>;
    const guardian = users.find((u) => u.role === "GUARDIAN");
    if (!guardian) throw new Error("No GUARDIAN user found in demo DB");
    guardianUserId = guardian.id;
  });

  async function openProfileInApp(page: import("@playwright/test").Page, userId: string) {
    await page.context().addCookies([
      { name: "school-erp-session", value: userId, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    await page.goto("/parent");
    // In-app (client-side) navigation, so the profile lands in the router cache.
    await page.locator("a[href^='/parent/profile']").first().click();
    await expect(page).toHaveURL(/\/parent\/profile/);
    await expect(page.getByRole("heading", { name: "Profil" })).toBeVisible();
  }

  async function expectSignedOutAfterBack(page: import("@playwright/test").Page) {
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
    await page.goBack();
    // Back must not resurrect the profile: it lands on the login page.
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Profil" })).toHaveCount(0);
    await expect(page.getByText(/Wali murid/)).toHaveCount(0);
    await expect(page.locator("text=An Nisaa").first()).toBeVisible();
  }

  test("profile-page Keluar button", async ({ page }) => {
    await openProfileInApp(page, guardianUserId);
    await page.locator("button", { hasText: /^Keluar$/ }).click();
    // PARX-7: the profile button now asks "Keluar dari Talib?" first.
    await page.getByRole("alertdialog").getByRole("button", { name: "Keluar", exact: true }).click();
    await expectSignedOutAfterBack(page);
  });

  test("header Keluar (confirm dialog)", async ({ page }) => {
    await openProfileInApp(page, guardianUserId);
    await page.click("[aria-label='Keluar']");
    await page.getByRole("button", { name: "Keluar dari akun", exact: true }).click();
    await expectSignedOutAfterBack(page);
  });
});
