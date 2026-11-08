import { test, expect } from "@playwright/test";

// E2E for the C4 walas weekly UI. Demo TEACHER resolves to a live HOMEROOM
// employee in demo mode, so the walas-gate path renders across staging seeds.
//
// The seed is date-relative (prisma/seed.ts): curriculum weeks cover the whole
// active semester, so on a school day "today" resolves to a live Pekan and the
// page renders the roster; on a weekend or holiday the current week does not
// bracket today and the page falls back to the no_active_week branch. Both are
// valid — the walas-only header "Penilaian pekanan" + the class-name subtitle
// surface either way, proving the homeroom + ageGroup detection works
// end-to-end — so the specs below accept either branch for "today" and pin the
// active-week path to a live week discovered through the curriculum API.
//
// The 12 vitest cases on POST /api/teacher/assessment-entries +
// 4 cases on the client pure helpers cover the upsert math and the
// edge cases — the e2e here is the contract proof that the page
// reaches the API and the API persists.

const TEACHER_ID = "u_teacher";
const ADMIN_USER_ID = "u_super_admin";

test.describe("Teacher — Weekly assessment (C4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: "school-erp-session",
        value: TEACHER_ID,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("walas home exposes the explicit Buka penilaian destination", async ({ page }) => {
    await page.goto("/teacher");
    const assessment = page.getByRole("link", { name: /Buka penilaian/ });
    await expect(assessment).toBeVisible();
    await expect(assessment).toHaveAttribute("href", "/teacher/assessments/weekly");
    await assessment.click();
    await expect(page).toHaveURL(/\/teacher\/assessments\/weekly$/);
    await expect(page.getByRole("heading", { name: "Penilaian pekanan", exact: true })).toBeVisible();
  });

  test("assessments hub shows walas Penilaian pekanan card + sentra grid (C5 replaces the placeholder)", async ({
    page,
  }) => {
    await page.goto("/teacher/assessments");
    await page.waitForURL("**/teacher/assessments", { timeout: 15_000 });
    await expect(page.locator('[data-testid="hub-weekly-card"]')).toBeVisible({
      timeout: 10_000,
    });
    // C5 replaced the "Coming in C5" placeholder with the live 8-card
    // sentra grid — assert the grid is visible instead.
    await expect(page.locator('[data-testid="hub-center-grid"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="hub-center-worship"]'),
    ).toBeVisible();
  });

  test("/teacher/assessments/weekly resolves walas + classSection (today renders the active week or the no_active_week branch)", async ({
    page,
  }) => {
    await page.goto("/teacher/assessments/weekly");
    await page.waitForURL("**/teacher/assessments/weekly", {
      timeout: 15_000,
    });
    // The walas resolver succeeded → header carries the section name.
    await expect(
      page.locator("h1", { hasText: /^Penilaian pekanan$/ }),
    ).toBeVisible({ timeout: 10_000 });
    // School day → the live week's roster; weekend / holiday / break → the
    // empty-state branch. Use exact match to avoid the description paragraph
    // collision.
    await expect(
      page
        .getByText("Belum ada pekan aktif", { exact: true })
        .or(page.locator('[data-testid="weekly-roster"]'))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("/teacher/assessments/weekly?date=<live week> renders active chrome or empty state", async ({
    page,
  }) => {
    const weekRes = await page.request.get(
      "/api/admin/curriculum/weeks?status=ACTIVE&pageSize=1",
      { headers: { Cookie: `school-erp-session=${ADMIN_USER_ID}` } },
    );
    expect(weekRes.ok()).toBeTruthy();
    const weekJson = (await weekRes.json()) as {
      data?: Array<{ startDate: string }>;
    };
    const liveDate = weekJson.data?.[0]?.startDate?.slice(0, 10);
    if (!liveDate) {
      await page.goto("/teacher/assessments/weekly");
      await expect(
        page.locator("h1", { hasText: /^Penilaian pekanan$/ }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText("Belum ada pekan aktif", { exact: true }),
      ).toBeVisible();
      return;
    }

    await page.goto(`/teacher/assessments/weekly?date=${liveDate}`);
    await page.waitForURL(`**/teacher/assessments/weekly?date=${liveDate}`, {
      timeout: 15_000,
    });
    // Header + day chips render from the Week payload.
    await expect(
      page.locator("h1", { hasText: "Penilaian pekanan" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("radio", { name: /Sen \d{2}/ })).toBeVisible();
    // Roster renders one card per ACTIVE enrolment.
    await expect(page.locator('[data-testid="weekly-roster"]')).toBeVisible();
    // The IKTP picker shows even with zero theme links — when present, the
    // dropdown surfaces; when absent, an inline banner explains why.
    // Either branch is acceptable here — we're proving the page reached
    // the active-week branch, not a particular IKTP wiring state.
    const picker = page.getByTestId("indicator-picker");
    const banner = page.getByText(
      "Belum ada IKTP untuk tema pekan ini",
      { exact: false },
    );
    const pickerCount = await picker.count();
    const bannerCount = await banner.count();
    expect(pickerCount + bannerCount).toBeGreaterThan(0);
  });

  test("TK A homeroom sees the TK A theme, not a TK B theme on the same dates", async ({ page }) => {
    const admin = { headers: { Cookie: `school-erp-session=${ADMIN_USER_ID}` } };
    const yearsRes = await page.request.get("/api/academic-years", admin);
    const years = (await yearsRes.json()) as Array<{ name: string; status: string }>;
    const yearName = years.find((y) => y.status === "ACTIVE")?.name;
    const semRes = await page.request.get("/api/admin/curriculum/semesters?pageSize=100", admin);
    const sems = (await semRes.json()).data as Array<{ id: string; number: number; academicYear: { name: string } }>;
    const semesterId = sems.find((s) => s.number === 1 && s.academicYear.name === yearName)?.id;
    test.skip(!semesterId, "seed produced no Semester 1 for the ACTIVE academic year");

    // Far-future Monday that varies per run, clear of the seeded (shared) weeks.
    const monday = new Date(Date.UTC(2040, 0, 2 + 7 * (Math.floor(Date.now() / 1000) % 3000)));
    const friday = new Date(monday.getTime() + 4 * 86_400_000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const stamp = Date.now();

    const seedTree = async (ageGroup: "A" | "B", label: string) => {
      const themeName = `E2E ${label} ${stamp}`;
      const t = await page.request.post("/api/admin/curriculum/themes", {
        ...admin, data: { semesterId, name: themeName, order: 0, ageGroup },
      });
      expect(t.ok()).toBeTruthy();
      const themeId = (await t.json()).id as string;
      const st = await page.request.post("/api/admin/curriculum/subthemes", {
        ...admin, data: { themeId, name: `${label} Sub ${stamp}`, order: 0 },
      });
      expect(st.ok()).toBeTruthy();
      const subThemeId = (await st.json()).id as string;
      const w = await page.request.post("/api/admin/curriculum/weeks", {
        ...admin, data: { subThemeId, number: 1, startDate: ymd(monday), endDate: ymd(friday) },
      });
      expect(w.status(), await w.text()).toBe(201);
      return themeName;
    };
    // TK A and TK B weeks on the same dates are both accepted.
    const themeA = await seedTree("A", "TKA");
    const themeB = await seedTree("B", "TKB");

    await page.goto(`/teacher/assessments/weekly?date=${ymd(monday)}`);
    await expect(page.locator("h1", { hasText: "Penilaian pekanan" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`tema ${themeA}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(themeB)).toHaveCount(0);
  });
});
