import { test, expect } from "@playwright/test";

// E2E for the C5 sentra (CENTER) UI. Demo TEACHER (E003) — the same demo
// account that walas-tests run under. Per CTO Cycle B decision, sentra
// writes are open to any TEACHER (no center-assignment gate), so the
// walas demo also covers the sentra path.
//
// The seed is date-relative (prisma/seed.ts) — curriculum weeks cover the whole
// active semester — so the active-week branch is exercised on a live week
// discovered through the curriculum API rather than a pinned calendar date. Save
// flow is covered by the 11 vitest cases on POST + 8 on GET — replicating the
// full session POST end-to-end would require setting up an indicator + theme
// link per spec run for marginal gain.

const TEACHER_ID = "u_teacher";

test.describe("Teacher — Sentra (CENTER) assessment (C5)", () => {
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

  test("hub shows the 8 sentra cards", async ({ page }) => {
    await page.goto("/teacher/assessments");
    await page.waitForURL("**/teacher/assessments", { timeout: 15_000 });
    await expect(page.locator('[data-testid="hub-center-grid"]')).toBeVisible({
      timeout: 10_000,
    });
    for (const slug of [
      "worship",
      "natural_materials",
      "art",
      "cooking",
      "role_play",
      "blocks",
      "preparation",
      "area",
    ]) {
      await expect(
        page.locator(`[data-testid="hub-center-${slug}"]`),
      ).toBeVisible();
    }
  });

  test("clicking the Sentra Ibadah card lands on the center session page", async ({
    page,
  }) => {
    await page.goto("/teacher/assessments");
    await page.waitForURL("**/teacher/assessments", { timeout: 15_000 });
    await page.locator('[data-testid="hub-center-worship"]').click();
    await page.waitForURL("**/teacher/assessments/center/worship", {
      timeout: 15_000,
    });
    await expect(
      page.locator("h1", { hasText: "Sentra Ibadah" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="center-date"]')).toBeVisible();
    await expect(page.locator('[data-testid="agegroup-A"]')).toBeVisible();
    await expect(page.locator('[data-testid="agegroup-B"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="center-activity"]'),
    ).toBeVisible();
    // The sticky save footer only renders for a writable session. On a date
    // outside the seeded Pekan range the page renders the `no_active_week`
    // recovery state, and a read-only session renders the "hanya bisa dilihat" notice —
    // assert that contract instead of an unconditional save button.
    await expect(
      page
        .locator('[data-testid="center-save"]')
        .or(page.getByRole("status").filter({ hasText: "hanya bisa dilihat" }))
        .or(page.getByRole("alert"))
        .first(),
    ).toBeVisible();
  });

  // Active-week branch: pick a live curriculum week via the admin API (the seed
  // is date-relative, so no calendar date is pinned) and switch the date input
  // to its Monday — the GET then reaches the active-week path and the page shows
  // either the IKTP picker or the "no IKTP for this theme" banner.
  test("active-week branch renders indicator picker on a seeded date", async ({
    page,
  }) => {
    const weekRes = await page.request.get(
      "/api/admin/curriculum/weeks?status=ACTIVE&pageSize=1",
      { headers: { Cookie: "school-erp-session=u_super_admin" } },
    );
    expect(weekRes.ok()).toBeTruthy();
    const liveDate = ((await weekRes.json()) as { data?: Array<{ startDate: string }> })
      .data?.[0]?.startDate?.slice(0, 10);
    expect(liveDate, "seed must provide at least one ACTIVE curriculum week").toBeTruthy();

    // The SSR date input is editable before hydration. Wait for the initial
    // client request and its rendered state so fill cannot be lost on hydrate.
    const initialResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname ===
      "/api/teacher/assessment-entries/center/WORSHIP",
    );
    await page.goto("/teacher/assessments/center/worship");
    await page.waitForURL("**/teacher/assessments/center/worship", {
      timeout: 15_000,
    });
    const initialResponse = await initialResponsePromise;
    const initialBody = await initialResponse.json();
    expect([200, 422]).toContain(initialResponse.status());
    if (initialResponse.status() === 422) {
      expect(initialBody.reason).toBe("no_active_week");
    }
    await expect(
      page.getByTestId("center-indicator-picker")
        .or(page.getByText("Belum ada IKTP untuk tema pekan ini", { exact: true }))
        .or(page.getByText("Belum ada pekan aktif untuk tanggal ini", { exact: true })),
    ).toBeVisible();

    const dateInput = page.getByTestId("center-date");
    // When today is the seeded Monday, the initial response already covers
    // this date; filling the same value intentionally sends no second request.
    const selectedResponsePromise = initialBody.date === liveDate
      ? Promise.resolve(initialResponse)
      : page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/teacher/assessment-entries/center/WORSHIP"
          && url.searchParams.get("date") === liveDate;
      });
    await dateInput.fill(liveDate!);
    const selectedResponse = await selectedResponsePromise;
    expect(selectedResponse.status()).toBe(200);
    expect((await selectedResponse.json()).date).toBe(liveDate);
    await expect(dateInput).toHaveValue(liveDate!);
    // Wait for the GET to settle: the indicator picker OR the no-IKTP
    // banner (either branch proves the active-week path reached). The
    // date-change fetch races a setLoading(true) DOM clear, so the poll has
    // to wait through the request round-trip plus the re-hydration of the
    // picker list.
    await expect
      .poll(
        async () => {
          const picker = await page
            .locator('[data-testid="center-indicator-picker"]')
            .count();
          const banner = await page
            .getByText("Belum ada IKTP untuk tema pekan ini", {
              exact: false,
            })
            .count();
          return picker + banner;
        },
        { timeout: 60_000, intervals: [500, 1000, 2000, 5000] },
      )
      .toBeGreaterThan(0);
  });
});
