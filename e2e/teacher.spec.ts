import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { test, expect } from "@playwright/test";

// Demo mode E2E — discovers teacher user ID from /api/auth/users and sets
// session cookie directly to avoid rate limit on repeated logins.

let teacherUserId: string;

function localRosterDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("Roster e2e resets one fixture attendance: DATABASE_URL must be a local disposable Postgres.");
  }
  return url;
}

/** Test setup only, like attendance-geofence-gate: never a shared database. */
async function ensureFreshRosterSession(userId: string) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const db = new Client({ connectionString: localRosterDatabaseUrl() });
  await db.connect();
  try {
    const { rows: fixtures } = await db.query<{ classSectionId: string; employeeId: string; semesterId: string; studentId: string; studentName: string }>(
      `SELECT c.id AS "classSectionId", u."employeeId", sem.id AS "semesterId", s.id AS "studentId", s.name AS "studentName"
       FROM "User" u
       JOIN "TeachingAssignment" ta ON ta."employeeId" = u."employeeId"
       JOIN "ClassSection" c ON c.id = ta."classSectionId" AND c."tenantId" = u."tenantId"
       JOIN "Semester" sem ON sem."academicYearId" = c."academicYearId" AND sem."tenantId" = c."tenantId"
       JOIN "StudentEnrollment" e ON e."classSectionId" = c.id AND e.status = 'ACTIVE'
       JOIN "Student" s ON s.id = e."studentId" AND s."tenantId" = c."tenantId"
       WHERE u.id = $1 AND c.status = 'ACTIVE'
       ORDER BY (ta.role = 'HOMEROOM') DESC, c.id, sem."startDate" DESC, length(s.name) DESC, s.id LIMIT 1`,
      [userId],
    );
    const fixture = fixtures[0];
    if (!fixture) throw new Error("Roster e2e needs an assigned class, semester and active student in the local seed.");
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM "ClassSession" WHERE "classSectionId" = $1 AND date = $2 AND "teacherId" = $3 ORDER BY slot LIMIT 1`,
      [fixture.classSectionId, date, fixture.employeeId],
    );
    let sessionId = existing.rows[0]?.id;
    if (!sessionId) {
      // Weekends and expired seed calendars may have no session. An explicit
      // local fixture tests the roster, not the calendar's eligibility policy.
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO "ClassSession" (id, "classSectionId", "semesterId", date, slot, "teacherId", "defaultTeacherId", "updatedAt")
         SELECT $1, $2, $3, $4, slots.slot, $5, $5, now()
         FROM (VALUES ('FULL_DAY'), ('MORNING'), ('AFTERNOON')) AS slots(slot)
         WHERE NOT EXISTS (SELECT 1 FROM "ClassSession" cs WHERE cs."classSectionId" = $2 AND cs.date = $4 AND cs.slot = slots.slot)
         LIMIT 1 RETURNING id`,
        [randomUUID(), fixture.classSectionId, fixture.semesterId, date, fixture.employeeId],
      );
      sessionId = inserted.rows[0]?.id;
    }
    if (!sessionId) throw new Error("Roster e2e could not reserve a local session without replacing another teacher's slot.");
    // A deliberately voided row renders neutral. Selecting a status must
    // restore this same row, not merely return success while it stays hidden.
    const notes = "E2E roster correction — retain original note";
    const attendance = await db.query<{ id: string; createdAt: Date }>(
      `INSERT INTO "StudentAttendance" (id, "studentId", "classSectionId", "sessionId", date, status, "isVoided", notes, "checkedInBy")
       VALUES ($1, $2, $3, $4, $5, 'SICK', true, $6, $7)
       ON CONFLICT ("studentId", "sessionId") DO UPDATE SET
         status = 'SICK', "isVoided" = true, "checkInTime" = null, "checkOutTime" = null,
         "pickedUpByRelation" = null, "pickedUpByName" = null, notes = $6
       RETURNING id, "createdAt"`,
      [randomUUID(), fixture.studentId, fixture.classSectionId, sessionId, date, notes, fixture.employeeId],
    );
    return { sessionId, studentName: fixture.studentName, studentId: fixture.studentId, attendanceId: attendance.rows[0].id, createdAt: attendance.rows[0].createdAt, notes };
  } finally {
    await db.end();
  }
}

test.describe("Teacher flows", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/auth/users");
    const users = await res.json();
    const teacher = users.find((u: { role: string }) => u.role === "TEACHER");
    if (!teacher) throw new Error("No TEACHER user found in demo DB");
    teacherUserId = teacher.id;
  });

  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{
      name: "school-erp-session",
      value: teacherUserId,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    await page.goto("/teacher");
    await page.waitForURL("**/teacher", { timeout: 15_000 });
  });

  test("home personal attendance matches the saved record and next action", async ({ page }) => {
    await expect(page.locator("text=Selamat")).toBeVisible();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [year, month] = today.split("-");
    const response = await page.request.get(`/api/attendance/my?year=${year}&month=${month}`);
    expect(response.ok()).toBeTruthy();
    const records = await response.json() as Array<{date:string;checkInTime:string|null;checkOutTime:string|null}>;
    const saved = records.find(record => record.date === today);
    const personal = page.locator('[aria-label="Kehadiran pribadi"]');
    // The seeded record for the latest school day is sometimes LATE (random 15-44 min after 07:00,
    // seeded per date), and the card then reads "Masuk 07.29 · Terlambat 29 menit · …".
    const LATE_LABEL = "(?: · Terlambat(?: \\d+ menit)?)?";
    await expect(personal).toBeVisible();
    // Assert the actual saved times in the browser's locale. Indonesian time
    // punctuation varies between local and CI ICU builds (07:30 vs 07.30).
    // The app renders every time in Asia/Jakarta (lib/format.ts), whatever the
    // runner's or device's zone, so the expectation must pin the same zone.
    const displayTimes = await page.evaluate((record) => {
      const format = (iso: string | null | undefined) => iso
        ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" })
        : null;
      return { checkIn: format(record?.checkInTime), checkOut: format(record?.checkOutTime) };
    }, saved ?? null);
    if (saved?.checkOutTime) {
      expect(displayTimes.checkIn).not.toBeNull();
      await expect(personal).toContainText(new RegExp(`Masuk ${displayTimes.checkIn}${LATE_LABEL} · pulang ${displayTimes.checkOut}`));
      await expect(personal.getByRole("button")).toHaveCount(0);
    } else if (saved?.checkInTime) {
      await expect(personal).toContainText(new RegExp(`Masuk ${displayTimes.checkIn}${LATE_LABEL} · sudah tercatat`));
      await expect(personal.getByRole("button", {name:"Catat pulang",exact:true})).toBeVisible();
    } else {
      await expect(personal).toContainText("Kehadiran pribadi belum dicatat");
      await expect(personal.getByRole("button", {name:"Catat masuk",exact:true})).toBeVisible();
    }
  });

  test("attendance calendar loads", async ({ page }) => {
    await page.goto("/teacher/attendance");
    await page.waitForURL("**/teacher/attendance");
    await expect(page.locator("text=Kehadiran saya")).toBeVisible();
    await expect(page.locator("text=Hadir").first()).toBeVisible();
  });

  test("salary slips page loads", async ({ page }) => {
    await page.goto("/teacher/slips");
    await page.waitForURL("**/teacher/slips", { timeout: 15_000 });
    await expect(page.locator("text=Slip gaji")).toBeVisible({ timeout: 10_000 });
    // Page fetches data async — wait up to 10s for either state to appear.
    // .first() — seed renders one "Tersedia" badge per slip; strict mode
    // would fail without scoping to the first match.
    await expect(
      page
        .locator("text=Tersedia")
        .or(page.locator("text=Belum ada slip gaji"))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("assessments landing page loads from Penilaian tab", async ({ page }) => {
    // Penilaian tab should be visible in bottom nav
    await expect(page.locator("nav").locator("text=Penilaian")).toBeVisible();
    await page.locator("nav").locator("text=Penilaian").click();
    await page.waitForURL("**/teacher/assessments", { timeout: 15_000 });
    await expect(page.locator("h1", { hasText: "Penilaian" })).toBeVisible({ timeout: 10_000 });
    // Penilaian consolidation: hub shows the new IKTP flow (sentra grid is
    // always present for any assigned teacher) or the no-class empty-state.
    // Legacy "Penilaian lama (template)" section retired.
    await expect(
      page
        .locator("text=Belum ditugaskan ke kelas")
        .or(page.getByTestId("hub-center-grid"))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("profile page loads", async ({ page }) => {
    await page.goto("/teacher/profile");
    await expect(page.locator("text=Profil saya")).toBeVisible();
    // Verify the info card rendered — the "Nama lengkap" label always appears
    await expect(page.locator("text=Nama lengkap")).toBeVisible();
    await expect(page.locator("text=Jabatan").first()).toBeVisible();
  });

  test("logout works", async ({ page }) => {
    // UAT 2026-05-12 — logout now opens a ConfirmDialog before signing out.
    await page.click("[aria-label='Keluar']");
    await page.getByRole("button", { name: "Keluar", exact: true }).click();
    await page.waitForURL("/", { timeout: 10_000 });
    // Post-rebrand landing wordmark = TalibWordmark → renders <span>Talib</span>.
    // exact:true avoids substring match on footer "Talib by An Nisaa' Sekolahku".
    await expect(page.getByText("Talib", { exact: true }).first()).toBeVisible();
  });

  test("teacher can open Buku Penghubung picker and entry page", async ({ page }) => {
    await page.goto("/teacher/student-journal");
    await page.waitForURL("**/teacher/student-journal", { timeout: 15_000 });
    // Either the picker heading or the empty-state for unassigned teachers
    await expect(
      page.locator("text=Buku Penghubung").or(page.locator("text=Belum ditugaskan ke kelas"))
    ).toBeVisible({ timeout: 10_000 });
    // If assigned classes exist, the CTA button should be visible
    const cta = page.getByRole("button", { name: /Isi Buku Penghubung/i });
    const isAssigned = await cta.isVisible({ timeout: 3_000 }).catch(() => false);
    if (isAssigned) {
      await expect(cta).toBeVisible();
    }
  });

  test("pickup region exposes every authorized session separately from classroom attendance", async ({ page }) => {
    const response = await page.request.get("/api/teacher/sessions");
    expect(response.ok()).toBeTruthy();
    const sessions = await response.json() as Array<{id:string;classSection:{name:string}}>;
    const pickup = page.getByRole("region", {name:"Sesi & penjemputan"});
    await expect(pickup).toBeVisible();
    await expect(pickup).toContainText("Perubahan di halaman sesi perlu disimpan");
    await expect(pickup).toContainText("Gerbang menyimpan tiap ketukan");
    const links = pickup.locator('a[href^="/teacher/sessions/"]');
    await expect(links).toHaveCount(sessions.length);
    for (const session of sessions) {
      await expect(pickup.locator(`a[href="/teacher/sessions/${session.id}"]`)).toContainText(session.classSection.name);
    }
    if (sessions.length === 0) {
      await expect(pickup.getByText("Belum ada sesi terjadwal hari ini", {exact:true})).toBeVisible();
      await expect(pickup).toContainText("Absensi dan jurnal kelas tetap bisa diisi");
    }
  });

  // A local fixture makes this flow run on weekends and after the seed's term
  // ends. Do not turn missing calendar data into a skipped UI regression check.
  test("teacher daily session flow: record roster attendance and verify it persists", async ({ page }) => {
    const fixture = await ensureFreshRosterSession(teacherUserId);
    const { sessionId, studentName } = fixture;

    // Keep full identities readable on the narrow phone from the audit.
    await page.setViewportSize({ width: 320, height: 740 });
    // Roster page is date-agnostic — navigate straight to it.
    await page.goto(`/teacher/sessions/${sessionId}`);
    await page.waitForURL(`**/teacher/sessions/${sessionId}`, { timeout: 15_000 });

    await expect(page.getByTestId("roster-row").first()).toBeVisible({ timeout: 15_000 });
    const rows = page.getByTestId("roster-row");
    const clippedNames = await rows.evaluateAll(elements => elements.flatMap(element => {
      const name = element.querySelector("p");
      return name && (name.scrollWidth > name.clientWidth || name.scrollHeight > name.clientHeight)
        ? [name.textContent]
        : [];
    }));
    expect(clippedNames).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const targetRow = rows.filter({ has: page.getByText(studentName, { exact: true }) });
    await expect(targetRow).toHaveCount(1);

    // The status affordance opens explicit choices; dismissing never edits.
    const statusPill = targetRow.getByRole("button", { name: /^Status .*Pilih status\.$/ });
    await expect(statusPill).toHaveAccessibleName(/: Belum dicatat\./);
    await statusPill.click();
    await expect(page.getByRole("menuitemradio")).toHaveCount(4);
    await expect(page.getByRole("menuitemradio", { checked: true })).toHaveCount(0);
    for (const item of await page.getByRole("menuitemradio").all()) {
      await expect.poll(async () => (await item.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("menuitemradio", { name: "Hadir", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await statusPill.click();
    await expect(page.getByRole("menuitemradio", { name: "Hadir", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(statusPill).toBeFocused();
    await expect(statusPill).toHaveAccessibleName(/: Hadir\./);

    // Select Alpa by keyboard, then return to Hadir for arrival/pickup.
    await statusPill.press("Enter");
    await expect(page.getByRole("menuitemradio", { name: "Hadir", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitemradio", { name: "Alpa", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(statusPill).toHaveAccessibleName(/: Alpa\./);
    await expect(targetRow.getByRole("button", { name: /^Ketuk masuk$/ })).toHaveCount(0);
    await statusPill.click();
    await page.getByRole("menuitemradio", { name: "Hadir", exact: true }).click();
    await expect(statusPill).toHaveAccessibleName(/: Hadir\./);

    // Tap In — enables Tap Out.
    await targetRow.getByRole("button", { name: /^Ketuk masuk$/ }).click();
    await expect(targetRow.getByText(/^Masuk \d/)).toBeVisible();

    // Tap Out — reveals the pickup-relation Select.
    await targetRow.getByRole("button", { name: /^Ketuk pulang$/ }).click();
    await expect(targetRow.getByText(/^Pulang \d/)).toBeVisible();

    // Pickup relation — pick "Orang tua" (PARENT), which needs no name.
    await targetRow.getByRole("combobox").click();
    await page.getByRole("option", { name: "Orang tua" }).click();

    // Save — the sticky footer button reads "Simpan absensi · N siswa"; the
    // success toast confirms the bulk upsert landed.
    await page.getByRole("button", { name: /^Simpan absensi/ }).click();
    await expect(page.getByText(/Absensi tersimpan/)).toBeVisible({ timeout: 15_000 });

    // Reload — re-locate the SAME student row by name; the persisted check-in
    // time + check-out time + pickup relation must still show.
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloadedRow = page
      .getByTestId("roster-row")
      .filter({ hasText: studentName! })
      .first();
    await expect(reloadedRow).toBeVisible({ timeout: 15_000 });
    // Check-in shows as a "Masuk HH:MM" chip (persisted value).
    await expect(reloadedRow.getByText(/^Masuk \d/)).toBeVisible();
    // Check-out persisted → pickup Select renders with "Orang tua" selected.
    await expect(reloadedRow.getByText(/^Pulang \d/)).toBeVisible();
    await expect(reloadedRow.getByRole("combobox")).toContainText("Orang tua");
    const db = new Client({ connectionString: localRosterDatabaseUrl() });
    await db.connect();
    try {
      const saved = await db.query(`SELECT id, "isVoided", status, notes, "createdAt", "checkInTime", "checkOutTime" FROM "StudentAttendance" WHERE "sessionId" = $1 AND "studentId" = $2`, [sessionId, fixture.studentId]);
      expect(saved.rows).toHaveLength(1);
      expect(saved.rows[0]).toMatchObject({ id: fixture.attendanceId, isVoided: false, status: "PRESENT", notes: fixture.notes, createdAt: fixture.createdAt });
      expect(saved.rows[0].checkInTime).not.toBeNull();
      expect(saved.rows[0].checkOutTime).not.toBeNull();
    } finally {
      await db.end();
    }
  });

  test("teacher entry grid 'Lihat pekan' affordance navigates to per-student week view", async ({ page }) => {
    // Discover a class via the teacher's assignments. Skip if seed has none.
    await page.goto("/teacher");
    const assignmentsRes = await page.request.get("/api/teaching-assignments/my");
    if (!assignmentsRes.ok()) {
      test.skip(true, "demo seed has no /api/teaching-assignments/my endpoint or auth missing");
    }
    // The endpoint returns a bare array of assignments (not a { data } envelope).
    const assignmentsJson = (await assignmentsRes.json()) as
      | Array<{ classSectionId: string }>
      | { data?: Array<{ classSectionId: string }> };
    const assignments = Array.isArray(assignmentsJson) ? assignmentsJson : assignmentsJson.data ?? [];
    const classId = assignments[0]?.classSectionId;
    if (!classId) {
      test.skip(true, "teacher has no assigned classes in demo seed");
    }
    const today = new Date().toISOString().slice(0, 10);
    await page.goto(`/teacher/student-journal/entry?classId=${classId}&date=${today}`);
    const chevron = page.locator('[data-testid="open-week-view"]').first();
    // NB: `isVisible()` ignores its timeout option and answers instantly — wait for
    // the roster to render instead, so a slow first paint is not read as "no students".
    const isVisible = await chevron
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!isVisible) {
      test.skip(true, "class has no enrolled students in demo seed");
    }
    await chevron.click();
    await page.waitForURL(new RegExp(`/teacher/student-journal/students/[^/?#]+\\?week=${today}`), { timeout: 10_000 });
    await expect(page.locator("text=Kembali").first()).toBeVisible({ timeout: 10_000 });
  });

  // Teacher mirrors the parent portal's five-slot mobile-navigation contract:
  // four daily-work destinations plus the personal-pages overflow. Pin the
  // smallest supported Android widths so a longer label cannot quietly push a
  // slot outside the viewport again.
  test("teacher bottom nav keeps five unclipped slots at narrow mobile widths", async ({ page }) => {
    for (const width of [320, 360, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto("/teacher");
      await page.waitForURL("**/teacher", { timeout: 15_000 });

      const nav = page.getByRole("navigation", { name: "Navigasi utama guru" });
      await expect(nav).toBeVisible();
      const slots = nav.locator("a, button");
      await expect(slots).toHaveCount(5);
      for (const label of ["Beranda", "Absensi", "Jurnal", "Penilaian"]) {
        await expect(nav.getByRole("link", { name: label })).toBeVisible();
      }
      await expect(nav.getByRole("button", { name: "Lainnya" })).toBeVisible();

      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const boxes = await slots.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const label = element.querySelector("span")!;
          const range = document.createRange();
          range.selectNodeContents(label);
          const text = range.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(getComputedStyle(label).fontSize),
            textLeft: text.left,
            textRight: text.right,
          };
        }),
      );
      expect(boxes).toHaveLength(5);
      for (const [index, box] of boxes.entries()) {
        expect(box.left).toBeGreaterThanOrEqual(-0.5);
        expect(box.right).toBeLessThanOrEqual(width + 0.5);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.fontSize).toBeGreaterThanOrEqual(12);
        expect(box.textLeft).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(box.textRight).toBeLessThanOrEqual(box.right + 0.5);
        if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test("teacher bottom nav marks direct and overflow destinations active", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/teacher/student-journal");
    await page.waitForURL("**/teacher/student-journal", { timeout: 15_000 });
    const nav = page.getByRole("navigation", { name: "Navigasi utama guru" });
    await expect(nav.getByRole("link", { name: "Jurnal" })).toHaveAttribute("aria-current", "page");

    await page.goto("/teacher/gate");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Beranda" })).toHaveAttribute("aria-current", "page");

    await page.goto("/teacher/slips");
    await page.waitForURL("**/teacher/slips", { timeout: 15_000 });
    await expect(nav.getByRole("button", { name: "Lainnya" }).locator("span").last()).toHaveClass(/text-primary/);
  });

  test("teacher reaches a salary detail through Lainnya and returns to the slip list", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/teacher");
    const trigger = page.locator('nav[aria-label="Navigasi utama guru"] button:has-text("Lainnya")');
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const sheet = page.getByRole("navigation", { name: "Menu lainnya guru" });
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await sheet.getByRole("link", { name: /^Slip gaji/ }).click();
    await page.waitForURL("**/teacher/slips", { timeout: 15_000 });
    await expect(page).toHaveTitle("Slip Gaji · Talib");

    const detail = page.locator('a[href^="/teacher/slips/"]').first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    const detailHref = await detail.getAttribute("href");
    expect(detailHref).toMatch(/^\/teacher\/slips\/[^/]+$/);
    await detail.click();
    await page.waitForURL(/\/teacher\/slips\/[^/?#]+$/, { timeout: 15_000 });
    const periodTitle = await page.getByRole("heading", { level: 1 }).innerText();
    await expect(page).toHaveTitle(`Slip Gaji ${periodTitle} · Talib`);

    // `Tunjangan Transport` is a stable, multi-word component in the demo
    // payroll seed. Exercise the real line at both narrow supported widths,
    // then check a final content row clears the fixed bottom navigation.
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(detailHref!);
      await page.waitForURL(/\/teacher\/slips\/[^/?#]+$/, { timeout: 15_000 });

      const longComponent = page.getByText("Tunjangan Transport", { exact: true });
      await expect(longComponent).toBeVisible({ timeout: 10_000 });
      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      )).toBe(true);

      const bottomContent = page.getByText(
        "Slip ini dihasilkan otomatis oleh Talib by An Nisaa' Sekolahku. Dokumen resmi.",
        { exact: true },
      );
      await bottomContent.scrollIntoViewIfNeeded();
      const [contentBox, navBox] = await Promise.all([
        bottomContent.boundingBox(),
        page.getByRole("navigation", { name: "Navigasi utama guru" }).boundingBox(),
      ]);
      expect(contentBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      // `boundingBox()` returns { x, y, width, height } — there is no
      // `bottom`, so derive it.
      expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(navBox!.y + 0.5);
    }

    await page.getByRole("link", { name: /Kembali ke slip gaji/ }).click();
    await page.waitForURL("**/teacher/slips", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Slip gaji" })).toBeVisible();
  });
});
