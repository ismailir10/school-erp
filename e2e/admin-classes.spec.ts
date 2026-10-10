import { randomUUID } from "node:crypto";
import { test, expect, type APIResponse } from "@playwright/test";

// E2E coverage for the consolidated /admin/classes surface (cycle:
// 2026-05-19-kelas-page). Demo-mode session cookie auth matches the
// pattern in admin.spec.ts.

const ADMIN_USER_ID = "u_super_admin";

test.describe("Admin /admin/classes", () => {
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
  });

  test("list page renders with year switcher + filters + DataTable", async ({
    page,
  }) => {
    await page.goto("/admin/classes");
    await page.waitForURL("**/admin/classes");

    await expect(page.getByRole("heading", { name: "Kelas" })).toBeVisible({
      timeout: 10_000,
    });
    // At least one SelectTrigger renders (year switcher + filters)
    await expect(page.getByRole("combobox").first()).toBeVisible();
    // Either rows or empty state — both acceptable for a fresh seed
    const tableVisible = page
      .locator("table")
      .or(page.getByText("Belum ada kelas"));
    await expect(tableVisible.first()).toBeVisible({ timeout: 10_000 });
  });

  test("create class find-or-creates ClassTrack on the unique key", async ({
    page,
  }) => {
    // Resolve a campus + program + active year via API to drive the POST.
    const [campusRes, programRes, yearRes] = await Promise.all([
      page.request.get("/api/config/campuses?status=ACTIVE"),
      page.request.get("/api/programs"),
      page.request.get("/api/academic-years"),
    ]);
    if (!campusRes.ok() || !programRes.ok() || !yearRes.ok()) {
      test.skip(true, "Reference data endpoints unavailable in demo seed");
      return;
    }
    const campuses = await campusRes.json();
    const programs = await programRes.json();
    const years = await yearRes.json();
    const campusList = Array.isArray(campuses) ? campuses : campuses.data ?? [];
    const programList = Array.isArray(programs) ? programs : programs.data ?? [];
    const yearList = Array.isArray(years) ? years : years.data ?? [];
    const activeYear =
      yearList.find((y: { status: string }) => y.status === "ACTIVE") ??
      yearList[0];
    if (!campusList[0] || !programList[0] || !activeYear) {
      test.skip(true, "Demo seed missing required reference rows");
      return;
    }

    const suffix = String(Date.now()).slice(-6);
    const className = `E2E ${suffix}`;
    const res = await page.request.post("/api/admin/classes", {
      data: {
        campusId: campusList[0].id,
        programId: programList[0].id,
        academicYearId: activeYear.id,
        name: className,
        // Kelompok usia (A/B) is required since the 2026-05-20 curriculum cutover.
        ageGroup: "A",
        capacity: 5,
        slotTemplate: "FULL_DAY",
      },
    });
    expect(res.ok()).toBeTruthy();
    const created = await res.json();
    expect(created.name).toBe(className);
    // ClassTrack auto-created — its id is non-empty and tied to the new section
    expect(created.classTrackId).toBeTruthy();
    expect(created.classTrack?.name).toBe(className);

    // Cleanup so subsequent runs stay idempotent
    await page.request.delete(`/api/admin/classes/${created.id}`).catch(() => {});
  });

  test("HOMEROOM uniqueness returns 409 HOMEROOM_EXISTS", async ({ page }) => {
    // Pick any class + any two employees in the tenant.
    const classes = await page.request
      .get("/api/admin/classes?pageSize=5")
      .then((r) => (r.ok() ? r.json() : null));
    const employees = await page.request
      .get("/api/employees?status=ACTIVE&pageSize=5")
      .then((r) => (r.ok() ? r.json() : null));
    const classList = classes?.data ?? [];
    const empList = employees?.data ?? employees ?? [];
    if (classList.length === 0 || empList.length < 2) {
      test.skip(true, "Demo seed has insufficient class/employee rows");
      return;
    }
    const klass = classList[0];

    // Clear any pre-existing HOMEROOM on this class to make the first POST land.
    await page.request
      .get(`/api/admin/classes/${klass.id}`)
      .then((r) => (r.ok() ? r.json() : null))
      .then(async (detail) => {
        const hr = detail?.teachingAssignments?.find(
          (a: { role: string }) => a.role === "HOMEROOM",
        );
        if (hr) {
          await page.request.delete(
            `/api/admin/classes/${klass.id}/teaching-assignments?employeeId=${hr.employee.id}`,
          );
        }
      });

    const first = await page.request.post(
      `/api/admin/classes/${klass.id}/teaching-assignments`,
      { data: { employeeId: empList[0].id, role: "HOMEROOM" } },
    );
    expect(first.ok()).toBeTruthy();

    const second = await page.request.post(
      `/api/admin/classes/${klass.id}/teaching-assignments`,
      { data: { employeeId: empList[1].id, role: "HOMEROOM" } },
    );
    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body.code).toBe("HOMEROOM_EXISTS");
    expect(body.existingEmployeeId).toBe(empList[0].id);

    // Cleanup
    await page.request.delete(
      `/api/admin/classes/${klass.id}/teaching-assignments?employeeId=${empList[0].id}`,
    );
  });

  test("enrollment add then remove round-trip", async ({ page }, testInfo) => {
    // Never sample existing students/classes: the first class can be archived
    // or full, and an arbitrary student can already have this year's placement.
    // Every response is attached so a rejected request cannot turn into a skip.
    async function checked(label: string, response: APIResponse, status = 200) {
      const body = await response.text();
      await testInfo.attach(label, {
        body: JSON.stringify({ status: response.status(), body }, null, 2),
        contentType: "application/json",
      });
      expect(response.status(), `${label}: HTTP ${response.status()} ${body}`).toBe(status);
      return JSON.parse(body);
    }
    const campuses = await checked("campus references", await page.request.get("/api/config/campuses?status=ACTIVE"));
    const programs = await checked("program references", await page.request.get("/api/programs"));
    const years = await checked("academic year references", await page.request.get("/api/academic-years"));
    const campusList = Array.isArray(campuses) ? campuses : campuses.data ?? [];
    const programList = Array.isArray(programs) ? programs : programs.data ?? [];
    const yearList = Array.isArray(years) ? years : years.data ?? [];
    const campus = campusList.find((c: { status: string }) => c.status === "ACTIVE");
    const program = programList.find((p: { status: string }) => p.status === "ACTIVE");
    const year = yearList.find((y: { status: string }) => y.status === "ACTIVE");
    expect(campus, "Enrollment fixture requires an active campus; see campus references attachment").toBeTruthy();
    expect(program, "Enrollment fixture requires an active program; see program references attachment").toBeTruthy();
    expect(year, "Enrollment fixture requires an active academic year; see academic year references attachment").toBeTruthy();

    // Put the new child inside the selected program's age band at year start.
    const ageMonths = program.ageMin != null && program.ageMax != null
      ? Math.floor((program.ageMin + program.ageMax) / 2)
      : program.ageMin ?? program.ageMax ?? 48;
    const birthDate = new Date(`${year.startDate}T00:00:00Z`);
    birthDate.setUTCDate(1);
    birthDate.setUTCMonth(birthDate.getUTCMonth() - ageMonths);
    const suffix = randomUUID().slice(0, 8);
    let classId: string | undefined;
    let studentId: string | undefined;
    let enrolled = false;
    try {
      const klass = await checked("create isolated class", await page.request.post("/api/admin/classes", {
        data: { campusId: campus.id, programId: program.id, academicYearId: year.id,
          name: `E2E Enrollment ${suffix}`, ageGroup: "A", capacity: 2, slotTemplate: "FULL_DAY" },
      }), 201);
      classId = klass.id;
      const student = await checked("create eligible student", await page.request.post("/api/students", {
        data: { name: `E2E Enrollment Student ${suffix}`, dateOfBirth: birthDate.toISOString().slice(0, 10), status: "ACTIVE" },
      }), 201);
      studentId = student.id;
      const emptyClass = await checked("isolated class starts empty", await page.request.get(`/api/admin/classes/${classId}`));
      expect(emptyClass.enrolledCount).toBe(0);
      expect(emptyClass.capacity).toBe(2);

      const enrollment = await checked("enroll eligible student", await page.request.post(`/api/admin/classes/${classId}/enrollments`, {
        data: { studentId },
      }), 201);
      enrolled = true;
      expect(enrollment.id).toBeTruthy();
      const populated = await checked("read populated roster", await page.request.get(`/api/admin/classes/${classId}`));
      expect(populated.enrolledCount).toBe(1);
      expect(populated.enrollments).toEqual(expect.arrayContaining([expect.objectContaining({ student: expect.objectContaining({ id: studentId }) })]));

      await checked("remove enrollment", await page.request.delete(`/api/admin/classes/${classId}/enrollments?studentId=${studentId}`));
      enrolled = false;
      const emptyAgain = await checked("read roster after removal", await page.request.get(`/api/admin/classes/${classId}`));
      expect(emptyAgain.enrolledCount).toBe(0);
      expect(emptyAgain.enrollments).toEqual([]);
    } finally {
      if (enrolled && classId && studentId) {
        await checked("cleanup remaining enrollment", await page.request.delete(`/api/admin/classes/${classId}/enrollments?studentId=${studentId}`));
      }
      if (studentId) await checked("deactivate fixture student", await page.request.put(`/api/students/${studentId}`, { data: { status: "INACTIVE" } }));
      if (classId) await checked("deactivate fixture class", await page.request.delete(`/api/admin/classes/${classId}`));
    }
  });

  test("detail page renders with roster, teachers, calendar", async ({
    page,
  }) => {
    const classes = await page.request
      .get("/api/admin/classes?pageSize=1")
      .then((r) => (r.ok() ? r.json() : null));
    const klass = classes?.data?.[0];
    if (!klass) {
      test.skip(true, "Demo seed has no class to view");
      return;
    }
    await page.goto(`/admin/classes/${klass.id}`);
    await page.waitForURL(`**/admin/classes/${klass.id}`);

    // Header carries the class name + year badge
    await expect(page.locator(`text=${klass.name}`).first()).toBeVisible({
      timeout: 10_000,
    });
    // Section headings render
    await expect(page.getByText(/Ringkasan|Roster|Kehadiran/).first()).toBeVisible();
    await expect(
      page.getByText(/Siswa|Daftar Siswa/).first(),
    ).toBeVisible();
    await expect(page.getByText(/Guru Pengajar/).first()).toBeVisible();
  });

  test("retired URLs return 404", async ({ page }) => {
    const tracks = await page.request.get("/admin/class-tracks");
    expect(tracks.status()).toBe(404);
    const teachers = await page.request.get("/admin/teaching-assignments");
    expect(teachers.status()).toBe(404);
    const sections = await page.request.get("/admin/class-sections/anything");
    expect(sections.status()).toBe(404);
    // API trees deleted too
    const apiTracks = await page.request.get("/api/admin/class-tracks");
    expect(apiTracks.status()).toBe(404);
    const apiTeachers = await page.request.get("/api/teaching-assignments");
    expect(apiTeachers.status()).toBe(404);
  });

  test("nav sidebar shows Kelas under Kesiswaan; Tahun Ajaran lives in the settings hub", async ({
    page,
  }) => {
    // admin-dmmt-overhaul: the standalone "Akademik" sidebar group was
    // retired — Kelas moved into Kesiswaan, and Tahun Ajaran moved into the
    // /admin/settings hub (no longer a sidebar row at all).
    await page.goto("/admin");
    await page.waitForURL("**/admin");
    await expect(page.getByRole("button", { name: "Kesiswaan" })).toBeVisible({
      timeout: 10_000,
    });
    // Kelas item present under Kesiswaan
    await expect(page.locator("text=Kelas").first()).toBeVisible();
    // Old labels gone
    await expect(page.locator("text=Identitas Kelas")).toHaveCount(0);
    await expect(page.locator("text=Guru Pengajar")).toHaveCount(0);

    // Tahun Ajaran no longer renders as a sidebar row — confirm via the hub.
    await page.goto("/admin/settings");
    await expect(page.getByRole("link", { name: /Tahun Ajaran/ })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Naik Kelas Massal dialog opens with year/class selectors and roster placeholder", async ({
    page,
  }) => {
    await page.goto("/admin/classes");
    await page.waitForURL("**/admin/classes");
    const trigger = page.getByRole("button", { name: "Naik Kelas Massal" });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    await expect(
      page.getByRole("heading", { name: "Naik Kelas Massal" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Tahun Ajaran Asal")).toBeVisible();
    await expect(page.getByText("Kelas Tujuan").first()).toBeVisible();
    // No source class chosen yet → placeholder copy, submit disabled
    await expect(
      page.getByText("Pilih kelas asal untuk melihat daftar siswa."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Naik Kelas \(0 siswa\)/ }),
    ).toBeDisabled();
  });

  test("promotions API rejects a missing source class", async ({ page }) => {
    const res = await page.request.get("/api/promotions");
    expect(res.status()).toBe(400);
    const j = await res.json();
    expect(j.error).toContain("sourceClassSectionId");
  });

  test("promotions POST executes the capacity lock query (regression: 0A000 FOR UPDATE+GROUP BY)", async ({
    page,
  }) => {
    // Exclude every student so the transaction runs its row-lock capacity
    // query against real Postgres but mutates nothing (promoted: 0). The
    // original query combined FOR UPDATE with GROUP BY, which Postgres
    // rejects (0A000) — every POST failed until the 2026-06-12 fix. A
    // mocked unit test cannot catch this class of bug; this can.
    const sectionsRes = await page.request.get("/api/class-sections");
    if (!sectionsRes.ok()) {
      test.skip(true, "class-sections endpoint unavailable in demo seed");
      return;
    }
    const sectionsJson = await sectionsRes.json();
    const sections = Array.isArray(sectionsJson)
      ? sectionsJson
      : sectionsJson.data ?? [];
    if (sections.length < 2) {
      test.skip(true, "need ≥2 class sections in seed");
      return;
    }
    const [source, target] = sections;

    const roster = await page.request.get(
      `/api/promotions?sourceClassSectionId=${source.id}`,
    );
    expect(roster.status()).toBe(200);
    const rosterJson = await roster.json();
    const excludeStudentIds = rosterJson.students.map(
      (s: { id: string }) => s.id,
    );

    const res = await page.request.post("/api/promotions", {
      data: {
        sourceClassSectionId: source.id,
        targetClassSectionId: target.id,
        excludeStudentIds,
      },
    });
    const j = await res.json();
    expect(res.status(), JSON.stringify(j)).toBe(200);
    expect(j.promoted).toBe(0);
    expect(j.skipped).toBe(excludeStudentIds.length);
  });
});
