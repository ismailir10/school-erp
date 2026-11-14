import { test, expect } from "@playwright/test";

// Demo-mode smoke for the admin raport MVP. On a fresh seed (no Term) the
// surface opens on the "Buat Triwulan" create form; once a Term exists (e.g. a
// drifted staging DB, or a fresh seed that later gains a Term) it opens on the
// Triwulan/Kelas selector. The smoke tolerates EITHER surface — we only assert
// the page renders and its APIs answer (no 500), not which branch shows.

const ADMIN_USER_ID = "u_super_admin"; // SUPER_ADMIN — has reportCard.*

test.describe("Admin raport", () => {
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
    await page.goto("/admin/report-cards");
    await page.waitForURL("**/admin/report-cards", { timeout: 15_000 });
  });

  test("raport surface loads", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Rapor", exact: true })).toBeVisible();
    // Tolerate either surface: the "Buat Triwulan" create card (no Term seeded)
    // OR the "Triwulan" term selector (a Term exists). The label is exact so it
    // does not also match the "Buat Triwulan" heading.
    const createCard = page.getByRole("heading", { name: "Buat Triwulan" });
    const termSelector = page.getByLabel("Triwulan", { exact: true });
    await expect(createCard.or(termSelector).first()).toBeVisible({ timeout: 10_000 });
  });

  test("raport APIs respond for an authorized admin", async ({ page }) => {
    const terms = await page.request.get("/api/admin/terms");
    expect(terms.status()).toBe(200);
    const termsJson = await terms.json();
    expect(Array.isArray(termsJson.data)).toBe(true);

    // Missing params → 400, proving the roster route is wired + validated.
    const roster = await page.request.get("/api/admin/report-cards");
    expect(roster.status()).toBe(400);
  });
});

// Deterministic API fixture exercises the SAME reader used by parents, through
// the real admin preview. No report is saved or published and no DB row changes.
// Geometry/scroll assertions need Chromium; JSDOM cannot reproduce the mobile
// side-specific h-auto override or focus-induced desktop scroll.
test.describe("Long Rapor shared reader", () => {
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    test(`bounds content and resets focus/scroll at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.context().addCookies([{ name: "school-erp-session", value: ADMIN_USER_ID, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
      const keys = ["INTRODUCTION", "RELIGIOUS_MORAL", "IDENTITY", "STEAM", "PERFORMANCE_SHOWCASE", "CLOSING", "FOLLOW_UP_PLAN", "HOME_ACTIVITIES"];
      const term = { id: "reader-term", number: 1, startDate: "2026-07-01", endDate: "2026-09-30", publishedAt: null, semester: { id: "reader-sem", number: 1, academicYear: { name: "2026/2027" } } };
      const student = { id: "reader-child", name: "Anak Uji Rapor Panjang", nickname: null };
      const saved = {
        sectionLevels: { RELIGIOUS_MORAL: "CONSISTENT" },
        sectionNarratives: Object.fromEntries(keys.map((key, index) => [key, `Bagian ${index + 1}. ${"Perkembangan anak dan kegiatan belajar bersama keluarga. ".repeat(35)}`])),
        sickDays: 1, permittedAbsenceDays: 2, unexcusedAbsenceDays: 0, totalSchoolDays: 45,
        memorizationNotes: "Penanda akhir rapor", status: "DRAFT", publishedAt: null,
      };
      await page.route("**/api/admin/terms", route => route.fulfill({ json: { data: [term] } }));
      await page.route("**/api/admin/classes?*", route => route.fulfill({ json: { data: [{ id: "reader-class", name: "TK A", status: "ACTIVE", academicYear: { id: "reader-year", name: "2026/2027", status: "ACTIVE" } }] } }));
      await page.route("**/api/admin/curriculum/semesters?*", route => route.fulfill({ json: { data: [] } }));
      await page.route("**/api/admin/report-cards?*", route => route.fulfill({ json: { data: { roster: [{ studentId: student.id, name: student.name, nickname: null, status: "DRAFT" }] } } }));
      await page.route("**/api/admin/report-cards/reader-child/reader-term", route => route.fulfill({ json: { data: {
        student, term: { id: term.id, number: 1, semesterNumber: 1, academicYear: "2026/2027" }, ageGroup: null, templates: null, measurement: null, saved,
        draft: { sections: Object.fromEntries(keys.slice(0, 5).map(key => [key, { suggested: null, counts: { CONSISTENT: 0, EMERGING: 0, NEEDS_REINFORCEMENT: 0, total: 0 } }])), attendance: { permittedAbsenceDays: 2, sickDays: 1, unexcusedAbsenceDays: 0, totalSchoolDays: 45 } },
      } } }));
      await page.goto("/admin/report-cards?termId=reader-term&classSectionId=reader-class&studentId=reader-child");
      const open = page.getByRole("button", { name: "Pratinjau rapor", exact: true });
      await open.click();
      const dialog = page.getByRole("dialog");
      const title = dialog.getByRole("heading", { name: `Pratinjau rapor — ${student.name}` });
      const scroller = dialog.locator('[data-slot="scroll-area-viewport"]');
      await expect(title).toBeFocused();
      await expect(dialog.getByRole("heading", { name: "Pembukaan", exact: true })).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
      const initialShot = testInfo.outputPath(`rapor-${viewport.width}-opening.png`);
      await page.screenshot({ path: initialShot });
      await testInfo.attach(`Rapor ${viewport.width}px opening`, { path: initialShot, contentType: "image/png" });
      // Actual pointer wheel scrolling, not assigning scrollTop as the assertion.
      await scroller.hover();
      await page.mouse.wheel(0, 100000);
      await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await expect(dialog.getByText("Penanda akhir rapor", { exact: true })).toBeInViewport();
      await expect(title).toBeInViewport();
      await expect(dialog.getByRole("button", { name: "Tutup", exact: true })).toBeInViewport();
      const finalShot = testInfo.outputPath(`rapor-${viewport.width}-last-section.png`);
      await page.screenshot({ path: finalShot });
      await testInfo.attach(`Rapor ${viewport.width}px last section`, { path: finalShot, contentType: "image/png" });
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
      await open.click();
      await expect(title).toBeFocused();
      expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
    });
  }
});
