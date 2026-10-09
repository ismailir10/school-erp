import { test, expect, type Page } from "@playwright/test";
import { SLIDES } from "../components/deck/slides";

// Product tour at /panduan: staff only. Demo-mode cookie auth, same pattern as the other specs.

type DemoUser = { id: string; role: string };
let users: DemoUser[] = [];

/** Headlines render twice by design (screen-reader text plus the animated copy), so match the accessible name. */
const heading = (page: Page, level: 1 | 2, title: string) =>
  page.getByRole("heading", { level, name: title, exact: true });

async function signInAs(page: Page, role: string) {
  const user = users.find((u) => u.role === role);
  if (!user) throw new Error(`No ${role} user in demo DB`);
  await page.context().addCookies([
    { name: "school-erp-session", value: user.id, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.describe("Panduan Talib (product tour)", () => {
  test.beforeAll(async ({ request }) => {
    users = await (await request.get("/api/auth/users")).json();
  });

  test("a signed-out visitor is sent to the sign-in screen", async ({ page }) => {
    await page.goto("/panduan");
    await expect(page).toHaveURL(/localhost:3000\/$/);
  });

  test("a parent is sent to their own portal", async ({ page }) => {
    await signInAs(page, "GUARDIAN");
    await page.goto("/panduan");
    await page.waitForURL("**/parent", { timeout: 15_000 });
  });

  test("an admin pages through all ten slides with the keyboard", async ({ page }) => {
    await signInAs(page, "SUPER_ADMIN");
    await page.goto("/panduan");
    await expect(heading(page, 1, SLIDES[0].title)).toBeVisible();

    for (let i = 1; i < SLIDES.length; i++) {
      await page.keyboard.press("ArrowRight");
      await expect(heading(page, 2, SLIDES[i].title)).toBeVisible();
      expect(new URL(page.url()).hash).toBe(`#${i + 1}`);
    }
    await expect(page.getByRole("button", { name: "Slide berikutnya" })).toBeDisabled();

    // No slide may force a sideways scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("a deep link opens that slide, and the rail jumps back", async ({ page }) => {
    await signInAs(page, "SUPER_ADMIN");
    await page.goto("/panduan#8");
    await expect(heading(page, 2, SLIDES[7].title)).toBeVisible();
    await page.getByRole("button", { name: /^Slide 2:/ }).click();
    await expect(heading(page, 2, SLIDES[1].title)).toBeVisible();
  });

  test("a teacher on a phone can read every slide and go back to their portal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, "TEACHER");
    await page.goto("/panduan");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Slide berikutnya" }).click();
    await expect(heading(page, 2, SLIDES[1].title)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "Kembali ke Beranda guru" }).click();
    await page.waitForURL("**/teacher", { timeout: 15_000 });
  });

  test("on a touch screen a sideways swipe changes slide and a vertical drag only scrolls", async ({ browser }) => {
    // Regression: touch-action sat on <main>, which the browser ignores once a scroll container sits
    // inside it, so every horizontal swipe was cancelled (pointercancel) and nothing moved.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const teacher = users.find((u) => u.role === "TEACHER");
    if (!teacher) throw new Error("No TEACHER user in demo DB");
    await context.addCookies([
      { name: "school-erp-session", value: teacher.id, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    await page.goto("/panduan#3");
    await expect(heading(page, 2, SLIDES[2].title)).toBeVisible();

    const cdp = await context.newCDPSession(page);
    const drag = async (from: [number, number], to: [number, number]) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: from[0] + ((to[0] - from[0]) * i) / 8, y: from[1] + ((to[1] - from[1]) * i) / 8 }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };

    await drag([320, 300], [80, 300]);
    await expect(heading(page, 2, SLIDES[3].title)).toBeVisible();
    await drag([80, 300], [320, 300]);
    await expect(heading(page, 2, SLIDES[2].title)).toBeVisible();

    await drag([200, 620], [212, 220]);
    await expect(heading(page, 2, SLIDES[2].title)).toBeVisible();
    expect(await page.evaluate(() => document.querySelector("[data-deck-scroll]")!.scrollTop)).toBeGreaterThan(100);
    await context.close();
  });
});
