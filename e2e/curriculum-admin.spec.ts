import { test, expect } from "@playwright/test";

// E2E for the C1 admin curriculum surface. Demo session as SUPER_ADMIN —
// only role with curriculum.write. The seed is date-relative (prisma/seed.ts):
// it places a curriculum (themes, sub-themes, Mon–Fri weeks, objectives) under
// BOTH semesters of the ACTIVE academic year, whatever its name is today. Tests
// therefore discover "Semester 1 of the ACTIVE year" through the API instead of
// pinning a year name, and use `.first()` where the AY name renders on more than
// one row.

const SUPER_ADMIN_ID = "u_super_admin";

/** Semester 1 of the ACTIVE academic year, discovered via the API. */
async function findActiveYearSemesterOne(
  page: import("@playwright/test").Page,
): Promise<{ id?: string; yearName?: string }> {
  const yearsRes = await page.request.get("/api/academic-years");
  const years = (await yearsRes.json()) as Array<{ name: string; status: string }>;
  const yearName = years.find((y) => y.status === "ACTIVE")?.name;
  const semRes = await page.request.get("/api/admin/curriculum/semesters?pageSize=100");
  const semJson = (await semRes.json()) as {
    data?: Array<{ id: string; number: number; academicYear: { name: string } }>;
  };
  const semester = semJson.data?.find((s) => s.number === 1 && s.academicYear.name === yearName);
  return { id: semester?.id, yearName };
}

test.describe("Admin curriculum", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: "school-erp-session",
        value: SUPER_ADMIN_ID,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    // The week start/end fields use the shared DatePicker, which renders a
    // Calendar popover on a fine pointer (desktop Chromium's default). Force
    // `(pointer: coarse)` so it takes its native-`<input type="date">` branch,
    // same as a real touch device gets; `.fill()` below targets that native
    // input by id — far simpler than paging a calendar to the 2030 dates this
    // suite seeds to dodge overlap with real data.
    await page.addInitScript(() => {
      const realMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        if (query === "(pointer: coarse)") {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return realMatchMedia(query);
      };
    });
  });

  test("semester list shows seeded row + sidebar Kurikulum entry", async ({ page }) => {
    await page.goto("/admin/semesters");
    await expect(page.getByRole("heading", { name: /Kurikulum.*Semester/i })).toBeVisible({
      timeout: 15_000,
    });
    const semRes = await page.request.get(
      "/api/admin/curriculum/semesters?status=ACTIVE&pageSize=1",
    );
    expect(semRes.ok()).toBeTruthy();
    const semJson = (await semRes.json()) as {
      data?: Array<{ status: string; academicYear?: { name?: string } }>;
    };
    expect(semJson.data?.[0]?.status).toBe("ACTIVE");
    const academicYearName = semJson.data?.[0]?.academicYear?.name;
    expect(academicYearName).toBeTruthy();
    if (!academicYearName) throw new Error("No semester academic year found");
    await expect(page.getByText(academicYearName).first()).toBeVisible();
    // admin-dmmt-overhaul: Semester moved out of the sidebar into the
    // /admin/settings hub (Sekolah section) — it no longer renders as a
    // `sidebar-menu-button`. Confirm it's reachable from the hub instead.
    await page.goto("/admin/settings");
    await expect(page.getByRole("link", { name: /Semester/ })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("theme create + subtheme create + week create end-to-end", async ({ page }) => {
    // Semester 1 of the ACTIVE academic year (name discovered, not pinned):
    // prior test runs may have left other `number: 1` semesters under
    // different years, so match BOTH the AY name and the semester number
    // rather than relying on list order.
    const { id: semesterId, yearName } = await findActiveYearSemesterOne(page);
    test.skip(!semesterId, "seed produced no Semester 1 for the ACTIVE academic year — skipping");

    await page.goto(`/admin/semesters/${semesterId}/themes`);
    await expect(
      page.getByText(new RegExp(`${yearName!.replace("/", "\\/")} · Semester 1`, "i")),
    ).toBeVisible({ timeout: 15_000 });

    const themeName = `E2E Tema ${Date.now()}`;
    await page.locator('[data-testid="theme-card"]').getByRole("button", { name: /Tambah/ }).click();
    await page.locator('[data-testid="theme-name-input"]').fill(themeName);
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(
      page.locator('[data-testid="theme-row"]').filter({ hasText: themeName }),
    ).toBeVisible({ timeout: 10_000 });

    // Select the newly created theme.
    await page.locator('[data-testid="theme-row"]').filter({ hasText: themeName }).click();

    const subThemeName = `E2E Subtema ${Date.now()}`;
    await page.locator('[data-testid="subtheme-card"]').getByRole("button", { name: /Tambah/ }).click();
    await page.locator('[data-testid="subtheme-name-input"]').fill(subThemeName);
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(
      page.locator('[data-testid="subtheme-row"]').filter({ hasText: subThemeName }),
    ).toBeVisible({ timeout: 10_000 });

    // Select the new subtheme.
    await page.locator('[data-testid="subtheme-row"]').filter({ hasText: subThemeName }).click();

    // Create a Mon–Fri week. Pick a stable far-future range so it cannot
    // overlap with seeded weeks: Mon 2030-01-07 → Fri 2030-01-11.
    await page.locator('[data-testid="week-card"]').getByRole("button", { name: /Tambah/ }).click();
    await page.locator("#week-start-date").fill("2030-01-07");
    await page.locator("#week-end-date").fill("2030-01-11");
    await page.locator('[data-testid="week-save"]').click();
    await expect(
      page.locator('[data-testid="week-row"]').filter({ hasText: /Pekan/ }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("week overlap → 409 surfaces inline error", async ({ page }) => {
    // Discover everything via API so renamed seed strings cannot silently
    // break this test — only structural assertions remain. Target Semester 1
    // of the ACTIVE academic year (prior runs may leave other `number: 1`
    // semesters behind).
    const { id: semesterId } = await findActiveYearSemesterOne(page);
    test.skip(!semesterId, "seed produced no Semester 1 for the ACTIVE academic year");

    const themeRes = await page.request.get(
      `/api/admin/curriculum/themes?semesterId=${semesterId}&status=ACTIVE&pageSize=1`,
    );
    const theme = (await themeRes.json()).data?.[0];
    test.skip(!theme, "seed produced no theme");

    const subRes = await page.request.get(
      `/api/admin/curriculum/subthemes?themeId=${theme.id}&status=ACTIVE&pageSize=1`,
    );
    const subTheme = (await subRes.json()).data?.[0];
    test.skip(!subTheme, "seed produced no subtheme");

    const weekRes = await page.request.get(
      `/api/admin/curriculum/weeks?subThemeId=${subTheme.id}&status=ACTIVE&pageSize=1`,
    );
    const existingWeek = (await weekRes.json()).data?.[0];
    test.skip(!existingWeek, "seed produced no week");

    const startYmd: string = existingWeek.startDate.slice(0, 10);
    const endYmd: string = existingWeek.endDate.slice(0, 10);

    await page.goto(`/admin/semesters/${semesterId}/themes`);

    await page
      .locator('[data-testid="theme-row"]')
      .filter({ hasText: theme.name })
      .first()
      .click();
    await page
      .locator('[data-testid="subtheme-row"]')
      .filter({ hasText: subTheme.name })
      .first()
      .click();

    await page.locator('[data-testid="week-card"]').getByRole("button", { name: /Tambah/ }).click();
    // Submit a one-day-shifted overlap so the candidate hits the existing
    // range without matching the unique (subThemeId, number) tuple.
    await page.locator("#week-start-date").fill(startYmd);
    await page.locator("#week-end-date").fill(endYmd);
    await page.locator('[data-testid="week-save"]').click();
    await expect(page.locator('[data-testid="week-overlap-error"]')).toBeVisible({
      timeout: 5_000,
    });
  });
});
