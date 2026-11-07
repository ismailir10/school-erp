import { test, expect } from "@playwright/test";
import { getTodayInTimezone } from "../lib/attendance/timezone";
import { rotationDayIndex } from "../lib/sentra/rotation";
import { academicYearFor, latestSchoolDay } from "../prisma/data/calendar";
import { allHolidays } from "../prisma/data/holidays";

// Sentra as data (cycle 2026-11-06-sentra-rotation), condensed to three
// cross-module flows. Demo-mode cookie auth, as the other portal specs.
//
// Seed (prisma/seed.ts): Taman Aster has "Putaran TK" (start 2026-01-05, two
// days) over TKIT A and TKIT B. day0: A -> Balok, B -> Seni; day1: A -> Seni,
// B -> Balok. u_teacher (E003) is guru sentra Balok and Walas TKIT A, so she
// reaches TKIT B only through the sentra. KB Metland is in no putaran.

const ROTATION_START = "2026-01-05";
const CYCLE_DAYS = 2;
const CLASS_BY_DAY_FOR_BALOK = ["TKIT A", "TKIT B"]; // class visiting Balok on day 0 / day 1

const today = getTodayInTimezone("Asia/Jakarta");
const recentSchoolDay = latestSchoolDay(today, new Set(allHolidays.map((holiday) => holiday.date)));
const academicStart = academicYearFor(today).start;
const assessmentDate = recentSchoolDay < academicStart ? academicStart : recentSchoolDay;
const dayIndex = rotationDayIndex(ROTATION_START, assessmentDate, CYCLE_DAYS);
const expectedClass = dayIndex === null ? null : CLASS_BY_DAY_FOR_BALOK[dayIndex];

function cookie(userId: string) {
  return [{ name: "school-erp-session", value: userId, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" as const }];
}

type ClassItem = { classSection: { id: string; name: string } };

test.describe("Sentra", () => {
  test("admin manages sentra and sees the putaran grid warn about a shared sentra", async ({ page }) => {
    await page.context().addCookies(cookie("u_super_admin"));
    await page.goto("/admin/sentra");
    await expect(page.getByRole("heading", { name: "Sentra", level: 1 })).toBeVisible();

    await page.getByRole("combobox", { name: "Kampus" }).click();
    await page.getByRole("option", { name: /Taman Aster/ }).click();

    // Seeded sentra with its guru.
    const balokRow = page.getByRole("row", { name: /Sentra Balok/ });
    await expect(balokRow).toBeVisible();
    await expect(balokRow).not.toContainText("Belum ada guru");

    // Create a sentra.
    const name = `Mikro E2E ${Date.now()}`;
    await page.getByRole("button", { name: "Tambah sentra" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nama sentra").fill(name);
    await dialog.getByRole("button", { name: "Tambah Sentra" }).click();
    await expect(page.getByRole("row", { name: new RegExp(`Sentra ${name}`) })).toBeVisible();

    // Open the seeded putaran: day labels, then a duplicate sentra on one day.
    await page.getByRole("link", { name: "Putaran TK" }).click();
    await expect(page.getByRole("heading", { name: "Putaran TK" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Pekan 1 · Senin" })).toBeVisible();

    const cellA = page.getByRole("combobox", { name: "TKIT A, Pekan 1 · Senin" });
    const cellB = page.getByRole("combobox", { name: "TKIT B, Pekan 1 · Senin" });
    await expect(cellA).toContainText("Sentra Balok");
    await expect(cellB).toContainText("Sentra Seni");
    await cellB.click();
    await page.getByRole("option", { name: "Sentra Balok" }).click();
    await expect(page.getByText(/dipakai dua kelas di Pekan 1 · Senin/)).toBeVisible();

    // Deliberately not saved: leave the page so the seed grid stays for the other flows.
    await page.goto("/admin/sentra");
  });

  test("guru sentra fills Buku Penghubung for a class she does not teach, and an outsider class stays closed", async ({ page }) => {
    await page.context().addCookies(cookie("u_teacher"));
    await page.setViewportSize({ width: 390, height: 844 });

    const adminCookie = "school-erp-session=u_super_admin";

    // The class list she may open: TKIT B only via the sentra.
    const classesRes = await page.request.get(`/api/student-journal/classes?date=${today}`);
    expect(classesRes.ok()).toBeTruthy();
    const classes = (await classesRes.json()) as ClassItem[];
    const classB = classes.find((c) => c.classSection.name === "TKIT B");
    expect(classB, "TKIT B must be reachable through sentra Balok").toBeTruthy();

    await page.goto("/teacher/student-journal?pick=1");
    const classSelect = page.getByRole("combobox", { name: "Kelas" });
    await expect(classSelect).toBeVisible();
    await classSelect.click();
    const optionB = page.getByRole("option", { name: /TKIT B/ });
    await expect(optionB).toContainText(/via sentra|\(hari ini\)/);
    await optionB.click();
    await page.getByRole("button", { name: "Isi Buku Penghubung" }).click();
    await page.waitForURL(new RegExp(`/teacher/student-journal/entry\\?classId=${classB!.classSection.id}`));

    // Roster loads; pick the first student and first indicator from the same API the page reads.
    const gridRes = await page.request.get(`/api/student-journal/class-grid?classSectionId=${classB!.classSection.id}&date=${today}`);
    expect(gridRes.ok()).toBeTruthy();
    const grid = (await gridRes.json()) as {
      data: {
        students: Array<{ id: string; name: string }>;
        categories: Array<{ indicators: Array<{ id: string; label: string }> }>;
      };
    };
    const student = grid.data.students[0];
    const indicator = grid.data.categories.flatMap((c) => c.indicators)[0];
    expect(student && indicator, "TKIT B needs a student and a journal indicator in the seed").toBeTruthy();

    async function openStudentIndicator() {
      await page.getByRole("button", { name: new RegExp(student.name) }).first().click();
      return page.getByRole("button", { name: indicator.label, exact: true }).first();
    }

    // The seed pre-fills today's journal, so flip whatever state the indicator is in.
    const tick = await openStudentIndicator();
    const wasChecked = /bg-primary\/10/.test((await tick.getAttribute("class")) ?? "");
    const saved = page.waitForResponse((r) => r.url().includes("/api/student-journal/entries/batch") && r.request().method() === "POST");
    await tick.click();
    expect((await saved).ok()).toBeTruthy();

    await page.reload();
    const afterReload = await openStudentIndicator();
    if (wasChecked) await expect(afterReload).not.toHaveClass(/bg-primary\/10/);
    else await expect(afterReload).toHaveClass(/bg-primary\/10/);

    // Outsider: KB Metland is in no putaran and not hers -> 403.
    const campusesRes = await page.request.get("/api/config/campuses", { headers: { Cookie: adminCookie } });
    const campuses = (await campusesRes.json()) as Array<{ id: string; name: string }>;
    const metland = campuses.find((c) => /Metland/i.test(c.name));
    expect(metland, "Metland campus missing from seed").toBeTruthy();
    const optionsRes = await page.request.get(`/api/admin/sentra/options?campusId=${metland!.id}`, { headers: { Cookie: adminCookie } });
    const kb = ((await optionsRes.json()) as { classes: Array<{ id: string; name: string }> }).classes.find((c) => c.name === "KB");
    expect(kb, "KB Metland class missing from seed").toBeTruthy();

    const denied = await page.request.get(`/api/student-journal/class-grid?classSectionId=${kb!.id}&date=${today}`);
    expect(denied.status()).toBe(403);
  });

  test("guru opens Sentra Harian from her own sentra and the admin monitor shows it", async ({ page }) => {
    await page.context().addCookies(cookie("u_teacher"));
    await page.goto("/teacher/assessments");
    await expect(page).toHaveTitle("Penilaian · Talib");

    const tiles = page.getByTestId("hub-center-grid").getByRole("link");
    const first = tiles.first();
    await expect(first).toContainText("Balok");
    await expect(first.getByText("Sentra saya")).toBeVisible();
    const initialSession = waitForCenterSession(today);
    await first.click();
    await page.waitForURL("**/teacher/assessments/center/*");
    await expect(page.getByRole("heading", { name: "Sentra Balok", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle("Sentra Balok · Talib");

    function waitForCenterSession(date: string) {
      return page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.startsWith("/api/teacher/assessment-entries/center/")
          && url.searchParams.get("date") === date;
      });
    }

    async function openAssessmentDate() {
      if (assessmentDate !== today) {
        const selectedSession = waitForCenterSession(assessmentDate);
        await page.getByTestId("center-date").fill(assessmentDate);
        expect((await selectedSession).ok()).toBeTruthy();
      }
      if (expectedClass) {
        await expect(page.getByTestId("center-class-switcher")).toContainText(expectedClass);
      }
    }

    await initialSession;
    await openAssessmentDate();
    const picker = page.getByTestId("center-indicator-picker");
    await expect(picker).toBeVisible();

    await page.getByTestId("center-activity").fill(`Balok E2E ${Date.now()}`);
    const indicatorBtn = picker.getByRole("button").first();
    if ((await indicatorBtn.getAttribute("aria-pressed")) !== "true") await indicatorBtn.click();
    await expect(indicatorBtn).toHaveAttribute("aria-pressed", "true");
    const roster = page.getByTestId("center-roster");
    const level = roster.getByRole("radio").first();
    await expect(level).toBeVisible();
    const levelLabel = await level.getAttribute("aria-label");
    await level.click();
    await expect(level).toHaveAttribute("aria-checked", "true");
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/teacher/assessment-entries/center"
      && response.request().method() === "POST",
    );
    await page.getByTestId("center-save").click();
    const saveResponse = await saved;
    expect(saveResponse.ok()).toBeTruthy();
    expect((await saveResponse.json()).written).toBeGreaterThan(0);
    await expect(page.getByText(/Penilaian tersimpan/)).toBeVisible();

    const reloadedSession = waitForCenterSession(today);
    await page.reload();
    await reloadedSession;
    await openAssessmentDate();
    await expect(page.getByTestId("center-roster").getByRole("radio", { name: levelLabel! }).first()).toHaveAttribute("aria-checked", "true");

    // Admin monitor names the sentra.
    const adminPage = await page.context().browser()!.newContext();
    await adminPage.addCookies(cookie("u_super_admin"));
    const admin = await adminPage.newPage();
    await admin.goto("/admin/assessments");
    await expect(admin.getByText("Sentra Balok").first()).toBeVisible();
    const monitor = await admin.request.get(`/api/admin/assessments?week=${assessmentDate}&day=${assessmentDate}`);
    expect(monitor.ok()).toBeTruthy();
    const { data } = (await monitor.json()) as { data: { sentra: Array<{ label: string; entries: number }> } };
    expect(data.sentra.find((row) => row.label === "Sentra Balok")?.entries).toBeGreaterThan(0);
    await adminPage.close();
  });
});
