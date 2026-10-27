import { test, expect } from "@playwright/test";

// SCHOOL_ADMIN persona — restricted role, no salary/payroll access.
// Cookie-based demo auth, same pattern as admin.spec.ts.

const SCHOOL_ADMIN_USER_ID = "u_school_admin";

test.describe("SCHOOL_ADMIN role restrictions", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{
      name: "school-erp-session",
      value: SCHOOL_ADMIN_USER_ID,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    await page.goto("/admin");
    await page.waitForURL("**/admin", { timeout: 15_000 });
  });

  test("payroll page redirects to /admin", async ({ page }) => {
    await page.goto("/admin/payroll");
    // Layout gate redirects non-SUPER_ADMIN back to /admin
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("payroll API returns 403", async ({ page }) => {
    const res = await page.request.get("/api/payroll");
    expect(res.status()).toBe(403);
  });

  test("employees list API returns 403 (hr.view gated)", async ({ page }) => {
    // Post-RBAC: /api/employees requires hr.view, which SCHOOL_ADMIN no longer holds.
    const res = await page.request.get("/api/employees?pageSize=1");
    expect(res.status()).toBe(403);
  });

  test("sidebar has no Penggajian nav link", async ({ page }) => {
    // Check by href — the sidebar nav link to /admin/payroll must not exist in the DOM
    await expect(page.locator('a[href="/admin/payroll"]').first()).not.toBeVisible();
  });

  test("employee salary API returns 403", async ({ page, request }) => {
    // Fetch an employee ID via a SUPER_ADMIN request context (post-RBAC,
    // SCHOOL_ADMIN cannot list employees), then probe the salary endpoint
    // with the SCHOOL_ADMIN page session — must be 403.
    const adminRes = await request.get("/api/employees?pageSize=1", {
      headers: { cookie: "school-erp-session=u_super_admin" },
    });
    expect(adminRes.status()).toBe(200);
    const { data } = await adminRes.json();
    const empId = data?.[0]?.id;
    if (!empId) {
      test.skip(true, "No employees seeded");
      return;
    }

    const salaryRes = await page.request.get(`/api/employees/${empId}/salary`);
    expect(salaryRes.status()).toBe(403);
  });

  test("SCHOOL_ADMIN demo user sees no SDM group in sidebar", async ({ page }) => {
    // Whole HR group (SDM) and its items must not render for SCHOOL_ADMIN.
    // Match the sidebar group label exactly to avoid accidental matches.
    // Use `not.toBeAttached()` not `toHaveCount(0)` — we want "never mounted",
    // not "mounted-but-hidden". Filter by permission in Task 6 removes the
    // whole group from the DOM, so the stricter assertion is accurate.
    await expect(page.getByRole("button", { name: "SDM" })).not.toBeAttached();
    await expect(page.locator('a[href="/admin/employees"]')).not.toBeAttached();
    await expect(page.locator('a[href="/admin/payroll"]')).not.toBeAttached();
  });

  test("/admin/employees redirects SCHOOL_ADMIN back to /admin", async ({ page }) => {
    await page.goto("/admin/employees");
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin$/);
  });

  // Cycle 2026-10-27-admin-curriculum-write: the school admin authors Kurikulum.
  test("SCHOOL_ADMIN creates a Tema, Subtema and Pekan", async ({ page }) => {
    // Native date inputs, as a touch device gets (the DatePicker popover is
    // not worth paging to 2030 — same trick as curriculum-admin.spec.ts).
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q === "(pointer: coarse)"
          ? ({ matches: true, media: q, onchange: null, addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } as MediaQueryList)
          : real(q);
    });

    const yearsRes = await page.request.get("/api/academic-years");
    const years = (await yearsRes.json()) as Array<{ name: string; status: string }>;
    const yearName = years.find((y) => y.status === "ACTIVE")?.name;
    const semRes = await page.request.get("/api/admin/curriculum/semesters?pageSize=100");
    const sems = (await semRes.json()) as {
      data?: Array<{ id: string; number: number; academicYear: { name: string } }>;
    };
    const semester = sems.data?.find((x) => x.number === 1 && x.academicYear.name === yearName);
    test.skip(!semester, "seed produced no Semester 1 for the ACTIVE academic year");

    await page.goto(`/admin/semesters/${semester!.id}/themes`);
    const themeCard = page.locator('[data-testid="theme-card"]');
    await expect(themeCard.getByRole("button", { name: /Tambah/ })).toBeVisible({ timeout: 15_000 });

    const themeName = `E2E Admin Tema ${Date.now()}`;
    await themeCard.getByRole("button", { name: /Tambah/ }).click();
    await page.locator('[data-testid="theme-name-input"]').fill(themeName);
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    const themeRow = page.locator('[data-testid="theme-row"]').filter({ hasText: themeName });
    await expect(themeRow).toBeVisible({ timeout: 10_000 });
    await themeRow.click();

    const subName = `E2E Admin Subtema ${Date.now()}`;
    await page.locator('[data-testid="subtheme-card"]').getByRole("button", { name: /Tambah/ }).click();
    await page.locator('[data-testid="subtheme-name-input"]').fill(subName);
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    const subRow = page.locator('[data-testid="subtheme-row"]').filter({ hasText: subName });
    await expect(subRow).toBeVisible({ timeout: 10_000 });
    await subRow.click();

    await page.locator('[data-testid="week-card"]').getByRole("button", { name: /Tambah/ }).click();
    await page.locator("#week-start-date").fill("2030-02-04");
    await page.locator("#week-end-date").fill("2030-02-08");
    await page.locator('[data-testid="week-save"]').click();
    await expect(
      page.locator('[data-testid="week-row"]').filter({ hasText: /Pekan/ }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Settings not pinned in sidebar footer (Keluar only)", async ({ page }) => {
    // Footer must contain only the Keluar button — Pengaturan moved into
    // the scrollable SidebarContent in Task 7.
    const footer = page.locator('[data-sidebar="footer"]');
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("button", { name: /Keluar/i })).toBeVisible();
    await expect(footer.getByRole("button", { name: /Pengaturan/i })).not.toBeAttached();
  });

  test("employee detail page redirects SCHOOL_ADMIN to /admin", async ({ page, request }) => {
    // Post-RBAC the whole (hr) route group — including employee detail —
    // is gated by hr.view at the layout. SCHOOL_ADMIN must be redirected.
    const adminRes = await request.get("/api/employees?pageSize=1&status=ACTIVE", {
      headers: { cookie: "school-erp-session=u_super_admin" },
    });
    const { data } = await adminRes.json();
    const empId = data?.[0]?.id;
    if (!empId) {
      test.skip(true, "No employees seeded");
      return;
    }

    await page.goto(`/admin/employees/${empId}`);
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin$/);
  });
});

// ----------------------------------------------------------------------
// Substitute-swap visibility (academic-hierarchy-refactor Task 9). Driven
// through the admin class-session API: discover a ClassSection, list its
// ClassSession rows, PATCH one to swap the effective teacher to a different
// employee with a substituteReason. The swap must change `teacherId` while
// leaving `defaultTeacherId` (the homeroom snapshot) untouched. API-driven —
// the swap semantics are the assertion, not the calendar UI.
//
// Uses a SUPER_ADMIN request context (cookie header) since class-session
// routes are isAdminRole-gated and the swap needs a 2nd tenant employee.
// ----------------------------------------------------------------------
const SUPER_ADMIN_COOKIE = "school-erp-session=u_super_admin";

test.describe("Class-session substitute swap", () => {
  test("PATCH swaps the effective teacher and preserves the homeroom snapshot", async ({ request }) => {
    const adminHeaders = { cookie: SUPER_ADMIN_COOKIE };

    // Discover class sections. The demo DB can carry roll-forward-cloned
    // sections (from this suite's roll-forward test) whose target year has no
    // Semester and therefore zero ClassSession rows — so we scan every ACTIVE
    // section until one yields a ClassSession with a homeroom teacher, rather
    // than blindly trusting the first.
    const sectionsRes = await request.get("/api/class-sections", { headers: adminHeaders });
    expect(sectionsRes.ok()).toBeTruthy();
    const sections = (await sectionsRes.json()) as Array<{ id: string; status: string }>;
    const activeSections = sections.filter((s) => s.status === "ACTIVE");
    if (activeSections.length === 0) {
      test.skip(true, "No ACTIVE class section in demo seed");
      return;
    }

    type SessionRow = {
      id: string;
      classSectionId: string;
      teacherId: string | null;
      defaultTeacherId: string | null;
    };
    let target: SessionRow | undefined;
    for (const section of activeSections) {
      const sessionsRes = await request.get(
        `/api/admin/class-sessions?classSectionId=${section.id}`,
        { headers: adminHeaders },
      );
      expect(sessionsRes.ok()).toBeTruthy();
      const sessions = (await sessionsRes.json()) as SessionRow[];
      const hit = sessions.find((s) => s.defaultTeacherId);
      if (hit) {
        target = hit;
        break;
      }
    }
    if (!target) {
      test.skip(true, "No ClassSession with a homeroom teacher in demo seed");
      return;
    }
    // Captured so the re-fetch + restore steps can re-scope to the section.
    const targetSectionId = target.classSectionId;

    // Find a substitute employee — any tenant employee that is NOT the
    // session's current default teacher.
    const empRes = await request.get("/api/employees?status=ACTIVE&pageSize=100", {
      headers: adminHeaders,
    });
    expect(empRes.ok()).toBeTruthy();
    const { data: employees } = (await empRes.json()) as {
      data: Array<{ id: string }>;
    };
    const substitute = employees.find((e) => e.id !== target.defaultTeacherId);
    if (!substitute) {
      test.skip(true, "Fewer than 2 employees — cannot do a meaningful swap");
      return;
    }

    // Swap the effective teacher with a substituteReason.
    const patchRes = await request.patch(`/api/admin/class-sessions/${target.id}`, {
      headers: adminHeaders,
      data: {
        teacherId: substitute.id,
        substituteReason: "E2E substitute swap — Task 9 coverage",
      },
    });
    expect(patchRes.ok()).toBeTruthy();
    const swapped = (await patchRes.json()) as {
      teacherId: string | null;
      defaultTeacherId: string | null;
      substituteReason: string | null;
    };
    // Effective teacher changed; homeroom snapshot untouched.
    expect(swapped.teacherId).toBe(substitute.id);
    expect(swapped.defaultTeacherId).toBe(target.defaultTeacherId);
    expect(swapped.substituteReason).toBe("E2E substitute swap — Task 9 coverage");

    // Verify the swap is visible on a re-fetch of the session list.
    const afterRes = await request.get(
      `/api/admin/class-sessions?classSectionId=${targetSectionId}`,
      { headers: adminHeaders },
    );
    const after = (await afterRes.json()) as SessionRow[];
    const afterRow = after.find((s) => s.id === target.id);
    expect(afterRow?.teacherId).toBe(substitute.id);
    expect(afterRow?.defaultTeacherId).toBe(target.defaultTeacherId);

    // Restore the original effective teacher so re-runs stay idempotent. A
    // revert to the homeroom snapshot needs no reason (the route clears it).
    if (target.teacherId === target.defaultTeacherId) {
      await request.patch(`/api/admin/class-sessions/${target.id}`, {
        headers: adminHeaders,
        data: { teacherId: target.defaultTeacherId },
      });
    } else {
      await request.patch(`/api/admin/class-sessions/${target.id}`, {
        headers: adminHeaders,
        data: {
          teacherId: target.teacherId,
          substituteReason: "E2E restore",
        },
      });
    }
  });
});

// Cycle 2026-10-17-payment-link-reminders (T8): the WhatsApp reminder queue on the
// invoice list. The app only opens wa.me (the admin presses send), so the test
// aborts the external navigation and checks what the app itself records.
test.describe("SCHOOL_ADMIN reminder queue", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{
      name: "school-erp-session",
      value: SCHOOL_ADMIN_USER_ID,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
  });

  test("opens from /admin/invoices, lists a wa.me link and records the reminder on tap", async ({ page }) => {
    // Never reach WhatsApp: the popup opens, its navigation is cut. Popups ignore
    // page.route, so the route lives on the context.
    await page.context().route("https://wa.me/**", (route) => route.abort());

    await page.goto("/admin/invoices");
    await page.getByRole("button", { name: "Pengingat WhatsApp" }).click();

    const dialog = page.getByRole("dialog", { name: "Pengingat WhatsApp" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const openLink = dialog.getByRole("link", { name: /Buka WhatsApp/ });
    // A seeded unpaid invoice may not hold a payment link yet; make one first.
    const makeLink = dialog.getByRole("button", { name: "Buat link dulu" }).first();
    await expect(openLink.or(makeLink).first()).toBeVisible({ timeout: 15_000 });
    if ((await openLink.count()) === 0) {
      await makeLink.click();
      await expect(openLink.first()).toBeVisible({ timeout: 30_000 });
    }

    // `has` resolves inside each list item, so it must not be rooted at the dialog.
    const row = dialog
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: /Buka WhatsApp/ }) })
      .first();
    expect(await row.getByRole("link", { name: /Buka WhatsApp/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\d+/);

    const [popup, stamp] = await Promise.all([
      page.context().waitForEvent("page"),
      page.waitForResponse(
        (r) => r.url().includes("/reminder") && r.request().method() === "POST" && r.status() === 200,
      ),
      row.getByRole("link", { name: /Buka WhatsApp/ }).click(),
    ]);
    expect(stamp.ok()).toBe(true);
    await popup.close();

    await expect(row).toContainText("Diingatkan baru saja", { timeout: 10_000 });
  });
});
