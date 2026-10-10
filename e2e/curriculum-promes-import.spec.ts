import { test, expect, type APIResponse } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Each run owns a PLANNING year and an ACTIVE semester. No seeded-year
// selection or ACTIVE-year switch is needed; cleanup closes both fixtures.

const SUPER_ADMIN_ID = "u_super_admin";
const FIXTURE_PATH = resolve(
  __dirname,
  "..",
  "lib",
  "curriculum",
  "__fixtures__",
  "promes-tk-a-smt-1.xlsx",
);

test.describe.configure({ mode: "serial" });

test.describe("Admin curriculum — PROMES import", () => {
  let semesterId: string | null = null;
  let academicYearId: string | null = null;
  let priorActiveYearId: string | null = null;

  async function checked<T>(response: APIResponse, action: string): Promise<T> {
    const body = await response.text();
    expect(response.ok(), `${action}: HTTP ${response.status()} ${body.slice(0, 500)}`).toBe(true);
    return JSON.parse(body) as T;
  }

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "school-erp-session", value: SUPER_ADMIN_ID, domain: "localhost", path: "/" }]);
    try {
      const api = ctx.request;
      const years = await checked<Array<{ id: string; endDate: string; status: string }>>(
        await api.get("/api/academic-years"), "Read years before PROMES setup",
      );
      priorActiveYearId = years.find((year) => year.status === "ACTIVE")?.id ?? null;
      // Avoid every non-archived range, including leftovers from earlier runs.
      const startYear = Math.max(new Date().getUTCFullYear() + 2,
        ...years.filter((year) => year.status !== "ARCHIVED").map((year) => Number(year.endDate.slice(0, 4)) + 1));
      const year = await checked<{ id: string }>(await api.post("/api/academic-years", {
        data: { name: `E2E PROMES Import ${Date.now()}`, startDate: `${startYear}-07-01`, endDate: `${startYear + 1}-06-30`, status: "PLANNING" },
      }), "Create isolated PROMES year");
      academicYearId = year.id;
      expect(academicYearId, "Year creation must return an id").toBeTruthy();
      const semester = await checked<{ id: string; status: string }>(await api.post("/api/admin/curriculum/semesters", {
        data: { academicYearId, number: 1, startDate: `${startYear}-07-15`, endDate: `${startYear}-12-19` },
      }), "Create isolated PROMES semester");
      semesterId = semester.id;
      expect(semesterId, "Semester creation must return an id").toBeTruthy();
      expect(semester.status).toBe("ACTIVE");
    } finally {
      await ctx.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "school-erp-session", value: SUPER_ADMIN_ID, domain: "localhost", path: "/" }]);
    try {
      // Inactive semester removes imported rows from future ACTIVE-semester
      // discovery; archived year frees its dates for subsequent test runs.
      if (semesterId) await checked(await ctx.request.put(`/api/admin/curriculum/semesters/${semesterId}`, {
        data: { status: "INACTIVE" },
      }), "Deactivate PROMES semester");
      if (academicYearId) await checked(await ctx.request.put(`/api/academic-years/${academicYearId}`, {
        data: { status: "ARCHIVED" },
      }), "Archive PROMES year");
      const years = await checked<Array<{ id: string; status: string }>>(
        await ctx.request.get("/api/academic-years"), "Verify ACTIVE year after PROMES cleanup",
      );
      expect(years.find((year) => year.status === "ACTIVE")?.id ?? null).toBe(priorActiveYearId);
    } finally {
      await ctx.close();
    }
  });

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
  });

  test("happy path: upload PROMES TK A → preview → commit → 30 IKTPs written", async ({
    page,
  }) => {
    expect(semesterId, "PROMES setup must create an isolated semester").toBeTruthy();

    const fixtureBuffer = readFileSync(FIXTURE_PATH);
    const filename = "PROMES TK A SMT 1.xlsx";

    await page.goto(
      `/admin/semesters/${semesterId}/import`,
    );

    // Stage 1 — upload form.
    await expect(
      page.getByRole("heading", { name: /Impor PROMES/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Fill file input + radio.
    await page
      .locator('input[type="file"]#promes-file')
      .setInputFiles({
        name: filename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: fixtureBuffer,
      });
    // Filename heuristic should pre-fill TK A — but click it explicitly
    // to also exercise the radio-onValueChange path.
    await page.getByRole("radio", { name: /TK A/ }).click();

    await page.getByRole("button", { name: /Pratinjau PROMES/i }).click();

    // Stage 2 — preview.
    await expect(
      page.getByText(/30 indikator/i),
    ).toBeVisible({ timeout: 20_000 });
    // Element labels visible (Indonesian copy).
    await expect(page.getByText("Nilai Agama dan Budi Pekerti")).toBeVisible();
    await expect(page.getByText("Jati Diri")).toBeVisible();
    await expect(page.getByText("STEAM / Literasi")).toBeVisible();
    // No conflicts on a fresh import.
    await expect(
      page.getByText(/konflik dengan tujuan pembelajaran/i),
    ).toHaveCount(0);

    // Stage 3 — commit. Wait for the success toast + redirect.
    await page.getByRole("button", { name: /Konfirmasi & simpan/i }).click();
    // Toast carries the counts.
    await expect(
      page.getByText(/PROMES berhasil diimpor.*15 tujuan/i),
    ).toBeVisible({ timeout: 15_000 });
    // Redirect lands on the /themes page.
    await expect(page).toHaveURL(
      new RegExp(`/admin/semesters/${semesterId}/themes`),
    );
  });

  test("re-import surfaces 409 conflict alert + commit blocked (button hidden)", async ({
    page,
  }) => {
    expect(semesterId, "PROMES setup must create an isolated semester").toBeTruthy();

    const fixtureBuffer = readFileSync(FIXTURE_PATH);
    const filename = "PROMES TK A SMT 1.xlsx";

    await page.goto(
      `/admin/semesters/${semesterId}/import`,
    );
    await expect(
      page.getByRole("heading", { name: /Impor PROMES/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page
      .locator('input[type="file"]#promes-file')
      .setInputFiles({
        name: filename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: fixtureBuffer,
      });
    await page.getByRole("radio", { name: /TK A/ }).click();
    await page.getByRole("button", { name: /Pratinjau PROMES/i }).click();

    // Conflict alert (depends on happy-path test having already committed
    // the rows). If the previous test hasn't run yet — or its commit
    // rolled back — we'd see 0 conflicts; this test asserts the UI
    // contract on the assumption that the row already exists.
    const alert = page.getByRole("alert").filter({
      hasText: /konflik dengan tujuan pembelajaran/i,
    });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // Conflicting row identification — TP 1 RELIGIOUS_MORAL is the first
    // objective in the fixture. Scope to the alert so we don't double-
    // match the preview Card that lists the same TP.
    await expect(
      alert.getByText(/Nilai Agama dan Budi Pekerti.*TP\s*1/i),
    ).toBeVisible();

    // Active conflicts hard-block the import: the 2026-05-20 status-aware
    // re-import (T5) removes the commit button entirely for ACTIVE conflicts
    // (only INACTIVE rows get skip/reactivate affordances). The commit path
    // is unreachable — assert the button is absent, not merely disabled.
    await expect(
      page.getByRole("button", { name: /Konfirmasi & simpan/i }),
    ).toHaveCount(0);
  });
});
