import { test, expect, type Page, type APIResponse } from "@playwright/test";

// Isolated curriculum fixtures: never pick whichever ACTIVE semester a
// previous spec happened to leave first in the list.

const SUPER_ADMIN_ID = "u_super_admin";

async function setAdminSession(page: Page) {
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
}

async function createObjective(
  page: Page,
  semesterId: string,
  fields: { number: number; competencyText: string; content: string },
) {
  const res = await page.request.post("/api/admin/curriculum/objectives", {
    data: {
      semesterId,
      ageGroup: "A",
      element: "RELIGIOUS_MORAL",
      number: fields.number,
      competencyText: fields.competencyText,
      content: fields.content,
    },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `createObjective failed: status=${res.status()} body=${body.slice(0, 300)}`,
    );
  }
  return ((await res.json()) as { id: string }).id;
}

async function checked<T>(response: Pick<APIResponse, "text" | "ok" | "status">, action: string): Promise<T> {
  const body = await response.text();
  expect(response.ok(), `${action}: HTTP ${response.status()} ${body.slice(0, 500)}`).toBe(true);
  return JSON.parse(body) as T;
}

test.describe.configure({ mode: "serial" });
test.describe("Admin curriculum — objectives (C3)", () => {
  let semesterId: string;
  let academicYearId: string;
  let theme: { id: string; name: string };
  let priorActiveYearId: string | null = null;
  let objectiveIds: string[] = [];
  let indicatorIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "school-erp-session", value: SUPER_ADMIN_ID, domain: "localhost", path: "/" }]);
    try {
      const api = ctx.request;
      const years = await checked<Array<{ id: string; endDate: string; status: string }>>(
        await api.get("/api/academic-years"), "Read years before objectives setup",
      );
      priorActiveYearId = years.find((year) => year.status === "ACTIVE")?.id ?? null;
      const startYear = Math.max(new Date().getUTCFullYear() + 2,
        ...years.filter((year) => year.status !== "ARCHIVED").map((year) => Number(year.endDate.slice(0, 4)) + 1));
      academicYearId = (await checked<{ id: string }>(await api.post("/api/academic-years", {
        data: { name: `E2E Objectives ${Date.now()}`, startDate: `${startYear}-07-01`, endDate: `${startYear + 1}-06-30`, status: "PLANNING" },
      }), "Create isolated objectives year")).id;
      expect(academicYearId, "Year creation must return an id").toBeTruthy();
      const semester = await checked<{ id: string; status: string }>(await api.post("/api/admin/curriculum/semesters", {
        data: { academicYearId, number: 1, startDate: `${startYear}-07-15`, endDate: `${startYear}-12-19` },
      }), "Create isolated objectives semester");
      semesterId = semester.id;
      expect(semesterId, "Semester creation must return an id").toBeTruthy();
      expect(semester.status).toBe("ACTIVE");
      theme = await checked<{ id: string; name: string }>(await api.post("/api/admin/curriculum/themes", {
        data: { semesterId, name: `E2E Theme ${Date.now()}`, order: 1 },
      }), "Create isolated indicator-link theme");
      expect(theme.id, "Theme creation must return an id").toBeTruthy();
    } finally { await ctx.close(); }
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "school-erp-session", value: SUPER_ADMIN_ID, domain: "localhost", path: "/" }]);
    try {
      if (theme?.id) await checked(await ctx.request.put(`/api/admin/curriculum/themes/${theme.id}`, { data: { status: "INACTIVE" } }), "Deactivate theme fixture");
      if (semesterId) await checked(await ctx.request.put(`/api/admin/curriculum/semesters/${semesterId}`, { data: { status: "INACTIVE" } }), "Deactivate objectives semester");
      if (academicYearId) await checked(await ctx.request.put(`/api/academic-years/${academicYearId}`, { data: { status: "ARCHIVED" } }), "Archive objectives year");
      const years = await checked<Array<{ id: string; status: string }>>(await ctx.request.get("/api/academic-years"), "Verify preserved ACTIVE year");
      expect(years.find((year) => year.status === "ACTIVE")?.id ?? null).toBe(priorActiveYearId);
    } finally { await ctx.close(); }
  });

  test.beforeEach(async ({ page }) => {
    objectiveIds = [];
    indicatorIds = [];
    await setAdminSession(page);
  });

  test.afterEach(async ({ browser }, testInfo) => {
    // A timed-out test's page.request can no longer run cleanup. Use the
    // hook's fresh context and report cleanup failures without replacing the
    // original failure (e.g. the missing checkbox response).
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "school-erp-session", value: SUPER_ADMIN_ID, domain: "localhost", path: "/" }]);
    const failures: string[] = [];
    async function cleanup(method: "post" | "put", url: string, data: object) {
      try {
        const response = await ctx.request[method](url, { data, timeout: 10_000 });
        if (!response.ok()) throw new Error(`HTTP ${response.status()} ${(await response.text()).slice(0, 500)}`);
      } catch (error) {
        failures.push(`${method.toUpperCase()} ${url}: ${String(error)}`);
      }
    }
    try {
      for (const indicatorId of indicatorIds) {
        await cleanup("post", "/api/admin/curriculum/indicator-theme-links", { indicatorId, themeId: theme.id, linked: false });
        await cleanup("put", `/api/admin/curriculum/indicators/${indicatorId}`, { status: "INACTIVE" });
      }
      for (const objectiveId of objectiveIds) {
        await cleanup("put", `/api/admin/curriculum/objectives/${objectiveId}`, { status: "INACTIVE" });
      }
    } finally { await ctx.close(); }
    if (failures.length) {
      await testInfo.attach("curriculum-fixture-cleanup-errors", { body: failures.join("\n"), contentType: "text/plain" });
      if (testInfo.status === testInfo.expectedStatus) throw new Error(failures.join("\n"));
    }
  });

  test("page renders + filter chips change visible rows", async ({ page }) => {
    // This spec owns the semester; use distinct slots even after deactivation.
    const objNumber = 101;
    const uniqueTag = `e2e-filter-${Date.now()}`;
    const objId = await createObjective(page, semesterId, {
      number: objNumber,
      competencyText: `Capaian ${uniqueTag}`,
      content: `TP ${uniqueTag}`,
    });

    objectiveIds.push(objId);
    await page.goto(`/admin/semesters/${semesterId}/objectives`);
    await expect(
      page.getByRole("heading", { name: /Tujuan Pembelajaran/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Default ACTIVE filter — the just-created TP must show.
    await expect(page.getByText(`TP ${uniqueTag}`)).toBeVisible();

    // Switch element filter to "Seni" — TK A RELIGIOUS_MORAL row drops.
    await page.getByRole("button", { name: "Seni", exact: true }).click();
    await expect(page.getByText(`TP ${uniqueTag}`)).toHaveCount(0);

    // Reset element to "Semua".
    await page
      .locator("div", { hasText: /^Elemen:/ })
      .getByRole("button", { name: "Semua", exact: true })
      .first()
      .click();
    await expect(page.getByText(`TP ${uniqueTag}`)).toBeVisible();

    // Status filter to "Tidak Aktif" — TP not yet deactivated, must not show.
    await page
      .getByRole("button", { name: "Tidak Aktif", exact: true })
      .click();
    await expect(page.getByText(`TP ${uniqueTag}`)).toHaveCount(0);
  });

  test("API-driven indicator + theme-link mutations surface in admin page", async ({
    page,
  }) => {
    const tag = `${Date.now()}`;
    const objNumber = 102;
    const objId = await createObjective(page, semesterId, {
      number: objNumber,
      competencyText: `Capaian ${tag}`,
      content: `TP api ${tag}`,
    });

    objectiveIds.push(objId);
    // Create an indicator via the C3 admin API.
    const iktpContent = `IKTP api ${tag}`;
    const indRes = await page.request.post(
      "/api/admin/curriculum/indicators",
      {
        data: { objectiveId: objId, content: iktpContent, order: 1 },
      },
    );
    const indicatorId = (await checked<{ id: string }>(indRes, "Create indicator fixture")).id;
    expect(indicatorId, "Indicator creation must return an id").toBeTruthy();
    indicatorIds.push(indicatorId);

    // Toggle the theme-link via the C3 idempotent endpoint.
    const linkRes = await page.request.post(
      "/api/admin/curriculum/indicator-theme-links",
      {
        data: { indicatorId, themeId: theme.id, linked: true },
      },
    );
    const linkBody = await checked<{ linked: boolean }>(linkRes, "Link indicator to isolated theme");
    expect(linkBody.linked).toBe(true);

    // Idempotent re-link is a no-op (still 200).
    const linkRes2 = await page.request.post(
      "/api/admin/curriculum/indicator-theme-links",
      {
        data: { indicatorId, themeId: theme.id, linked: true },
      },
    );
    await checked(linkRes2, "Repeat idempotent indicator link");

    // Render the admin objectives page; the IKTP must be visible inside
    // the parent TP accordion section. Default ACTIVE filter.
    await page.goto(`/admin/semesters/${semesterId}/objectives`);
    await expect(
      page.getByRole("heading", { name: /Tujuan Pembelajaran/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`TP api ${tag}`)).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`TP api ${tag}`) }).click();
    await expect(page.getByText(iktpContent, { exact: true })).toBeVisible();
    const linkedTheme = page.getByRole("checkbox", { name: theme.name, exact: true });
    await expect(linkedTheme).toBeChecked();
    // The panel animates its clipped height after opening. Wait for that
    // actual animation, then reveal the control fully before clicking it.
    await linkedTheme.locator('xpath=ancestor::*[@data-slot="accordion-content"]').evaluate(async (panel) => {
      await Promise.all(panel.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    });
    await linkedTheme.scrollIntoViewIfNeeded();
    await expect(linkedTheme).toBeInViewport({ ratio: 1 });
    const unlinkResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/curriculum/indicator-theme-links") && response.request().method() === "POST",
      { timeout: 10_000 },
    );
    // The controlled checkbox changes after the API response, not in the
    // same click tick; click then await the persisted state.
    await linkedTheme.click();
    await checked(await unlinkResponse, "Unlink theme through rendered checkbox");
    await expect(linkedTheme).not.toBeChecked();
    await page.reload();
    await page.getByRole("button", { name: new RegExp(`TP api ${tag}`) }).click();
    await expect(page.getByText(iktpContent, { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: theme.name, exact: true })).not.toBeChecked();

    // Inactive indicators remain visible with the restore affordance.
    // Verify that actual UI contract rather than claiming they are hidden.
    const deactRes = await page.request.put(
      `/api/admin/curriculum/indicators/${indicatorId}`,
      { data: { status: "INACTIVE" } },
    );
    await checked(deactRes, "Deactivate indicator fixture");
    await page.reload();
    await page.getByRole("button", { name: new RegExp(`TP api ${tag}`) }).click();
    await expect(page.getByText(iktpContent, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aktifkan IKTP #1" })).toBeVisible();

  });
});
