import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Geofenced check-in, admin approval, Absensi Staf Harian and Gerbang mode
// (cycle 2026-11-07-attendance-geofence-gate). Demo auth: the session cookie is
// a seeded user id. The seeded Taman Aster pin is the geofence centre; the
// teacher "Guru Tiga" belongs to that campus.
const TAMAN_ASTER = { latitude: -6.2234, longitude: 106.8432 };
// 0.0027° of latitude is about 300 m north of the pin.
const OUTSIDE = { latitude: -6.2207, longitude: 106.8432 };

function localDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("Geofence e2e resets today's attendance rows: DATABASE_URL must be a local disposable Postgres.");
  }
  return url;
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Test setup only: wipe today's attendance so each flow starts from "not recorded".
async function clearToday(scope: "teacher" | "all") {
  const db = new Client({ connectionString: localDatabaseUrl() });
  await db.connect();
  try {
    if (scope === "teacher") {
      await db.query(
        `DELETE FROM "AttendanceRecord" WHERE date = $1 AND "employeeId" = (SELECT "employeeId" FROM "User" WHERE id = 'u_teacher')`,
        [today()],
      );
    } else {
      await db.query(`DELETE FROM "AttendanceRecord" WHERE date = $1`, [today()]);
    }
  } finally {
    await db.end();
  }
}

// The gate needs today's class session. Weekends and holidays have none (the API answers 409 by design),
// so give the child's class a FULL_DAY session when the calendar left it without one.
async function ensureSessionToday(classSectionId: string) {
  const db = new Client({ connectionString: localDatabaseUrl() });
  await db.connect();
  try {
    const have = await db.query(`SELECT 1 FROM "ClassSession" WHERE "classSectionId" = $1 AND date = $2 LIMIT 1`, [classSectionId, today()]);
    if (have.rowCount) return;
    await db.query(
      `INSERT INTO "ClassSession" (id, "classSectionId", "semesterId", date, slot, "updatedAt")
       VALUES ($1, $2, (SELECT "semesterId" FROM "ClassSession" WHERE "classSectionId" = $2 LIMIT 1), $3, 'FULL_DAY', now())`,
      [randomUUID(), classSectionId, today()],
    );
  } finally {
    await db.end();
  }
}

async function signIn(context: BrowserContext, userId: string) {
  await context.addCookies([{ name: "school-erp-session", value: userId, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

async function openTeacherHome(page: Page) {
  await page.goto("/teacher");
  await page.waitForURL("**/teacher", { timeout: 15_000 });
  await expect(page.getByLabel("Kehadiran pribadi")).toBeVisible();
}

test.describe.serial("Geofenced check-in, staff day and gate", () => {
  test.use({ permissions: ["geolocation"], viewport: { width: 390, height: 844 } });

  test("inside the radius: one tap records Masuk without a note sheet", async ({ page, context }) => {
    await clearToday("teacher");
    await context.setGeolocation(TAMAN_ASTER);
    await signIn(context, "u_teacher");
    await openTeacherHome(page);

    await page.getByRole("button", { name: "Catat masuk", exact: true }).click();
    await expect(page.getByLabel("Kehadiran pribadi")).toContainText("sudah tercatat");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("pending-approval-chip")).toHaveCount(0);
  });

  test("outside the radius: note is required and the check-in waits for approval", async ({ page, context }) => {
    await clearToday("teacher");
    await context.setGeolocation(OUTSIDE);
    await signIn(context, "u_teacher");
    await openTeacherHome(page);

    await page.getByRole("button", { name: "Catat masuk", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(/Anda ± \d+ m dari Taman Aster/);
    const submit = sheet.getByRole("button", { name: "Kirim untuk disetujui" });
    await expect(submit).toBeDisabled();

    await sheet.getByLabel("Catatan untuk admin").fill("Mengantar siswa ke dokter");
    await submit.click();
    await expect(page.getByTestId("pending-approval-chip")).toHaveText("Menunggu persetujuan");
  });

  test.describe("admin", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("approves the pending check-in from Perlu persetujuan", async ({ page, context }) => {
      await signIn(context, "u_super_admin");
      await page.goto("/admin/employee-attendance");
      await page.getByRole("tab", { name: /Perlu persetujuan/ }).click();

      const row = page.getByTestId("pending-row").filter({ hasText: "Guru Tiga" });
      await expect(row).toContainText(/± \d+ m dari Taman Aster/);
      await expect(row).toContainText("Mengantar siswa ke dokter");
      await row.getByRole("button", { name: "Setujui", exact: true }).click();
      await expect(page.getByTestId("pending-row").filter({ hasText: "Guru Tiga" })).toHaveCount(0);
    });

    test("Absensi Staf Harian: Tandai semua hadir, then one Sakit exception, both persist", async ({ page, context }) => {
      await clearToday("all");
      await signIn(context, "u_super_admin");
      await page.goto("/admin/employee-attendance/daily");
      await expect(page.getByRole("heading", { name: "Absensi Staf Harian" })).toBeVisible();
      await expect(page.getByText("Belum dicatat").first()).toBeVisible();

      await page.getByRole("button", { name: /Tandai semua hadir/ }).click();
      await expect(page.getByText("Belum dicatat")).toHaveCount(0);

      const first = page.getByTestId("daily-row").first();
      await first.getByRole("button", { name: "Sakit", exact: true }).click();
      await expect(first.getByRole("button", { name: "Sakit", exact: true })).toHaveAttribute("aria-pressed", "true");

      await page.reload();
      await expect(page.getByText("Belum dicatat")).toHaveCount(0);
      await expect(page.getByTestId("daily-row").first().getByRole("button", { name: "Sakit", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("daily-row").nth(1).getByRole("button", { name: "Hadir", exact: true })).toHaveAttribute("aria-pressed", "true");
    });
  });

  test("Gerbang: a teacher records one child's arrival with a single tap", async ({ page, context }) => {
    await signIn(context, "u_teacher");
    const list = await page.request.get("/api/teacher/gate");
    expect(list.ok()).toBeTruthy();
    const { students } = (await list.json()) as { students: { studentId: string; name: string; className: string; classSectionId: string; checkInTime: string | null }[] };
    const child = students.find((s) => !s.checkInTime);
    test.skip(!child, "every child on the campus already has an arrival today");
    await ensureSessionToday(child!.classSectionId);

    // Gerbang lives on Beranda, directly under Kehadiran pribadi: one tap.
    await page.goto("/teacher");
    await page.getByRole("link", { name: /Gerbang/ }).click();
    await expect(page).toHaveURL(/\/teacher\/gate/);
    await page.getByLabel("Cari nama anak").fill(child!.name);
    // A child can sit in two placements (school + daycare): the label carries the class.
    const tap = page.getByRole("button", { name: `Masuk: ${child!.name}, ${child!.className}`, exact: true });
    await expect(tap).not.toContainText("tercatat");
    await tap.click();
    await expect(page.getByText(`${child!.name} masuk`)).toBeVisible();

    const after = await page.request.get("/api/teacher/gate");
    const { students: updated } = (await after.json()) as { students: { studentId: string; checkInTime: string | null }[] };
    expect(updated.find((s) => s.studentId === child!.studentId)?.checkInTime).toBeTruthy();
  });
});
