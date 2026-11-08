import { test, expect, type Page } from "@playwright/test";
import { RELEASES } from "../lib/changelog/releases";

// Apa yang Baru: signed-in only, any role. Demo-mode cookie auth, same pattern as the other specs.

type DemoUser = { id: string; role: string };
let users: DemoUser[] = [];

async function signInAs(page: Page, role: string) {
  const user = users.find((u) => u.role === role);
  if (!user) throw new Error(`No ${role} user in demo DB`);
  await page.context().addCookies([
    { name: "school-erp-session", value: user.id, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.describe("Apa yang Baru (changelog)", () => {
  test.beforeAll(async ({ request }) => {
    users = await (await request.get("/api/auth/users")).json();
  });

  test("a signed-out visitor is sent to the sign-in screen", async ({ page }) => {
    await page.goto("/changelog");
    await expect(page).toHaveURL(/localhost:3000\/$/);
  });

  for (const [role, home, back] of [
    ["SUPER_ADMIN", "/admin", "Dasbor admin"],
    ["TEACHER", "/teacher", "Beranda guru"],
    ["GUARDIAN", "/parent", "Beranda orang tua"],
  ] as const) {
    test(`${role} opens it and returns to their portal`, async ({ page }) => {
      await signInAs(page, role);
      await page.goto("/changelog");
      await expect(page.getByRole("heading", { level: 1, name: "Apa yang Baru" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await page.getByRole("link", { name: `Kembali ke ${back}` }).click();
      await page.waitForURL(`**${home}`, { timeout: 15_000 });
    });
  }

  test("a teacher sees their items first and every item after tapping Semua, without sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "TEACHER");
    await page.goto("/changelog");

    const cards = page.getByRole("article");
    const mine = await cards.count();
    expect(mine).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Untuk guru" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Semua", exact: true }).click();
    await expect(cards).toHaveCount(RELEASES.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("each portal links to it from its own menu", async ({ page }) => {
    await signInAs(page, "SUPER_ADMIN");
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Apa yang Baru" })).toHaveAttribute("href", "/changelog");

    await page.context().clearCookies();
    await signInAs(page, "GUARDIAN");
    await page.goto("/parent/profile");
    const card = page.getByRole("link", { name: /Apa yang Baru/ });
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: "Apa yang Baru" })).toBeVisible();
  });
});
