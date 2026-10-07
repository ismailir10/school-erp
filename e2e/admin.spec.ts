import { test, expect } from "@playwright/test";

// Demo mode E2E tests — discovers user ID from /api/auth/users and sets
// session cookie directly to avoid rate-limit on repeated beforeEach calls.

const ADMIN_USER_ID = "u_super_admin"; // Primary owner — SUPER_ADMIN

test.describe("Admin flows", () => {
  test.beforeEach(async ({ page }) => {
    // Set demo session cookie directly — avoids /api/auth/login rate limit
    await page.context().addCookies([{
      name: "school-erp-session",
      value: ADMIN_USER_ID,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    await page.goto("/admin");
    await page.waitForURL("**/admin", { timeout: 15_000 });
  });

  test("dashboard loads with the queue tiles and attendance strip", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Perlu ditangani" })).toBeVisible();
    await expect(page.getByTestId("dashboard-queue-tiles")).toBeVisible();
    await expect(page.getByTestId("dashboard-attendance-strip")).toBeVisible();
  });

  test("work queue table loads at /admin/work-queue", async ({ page }) => {
    await page.goto("/admin/work-queue");
    await page.waitForURL("**/admin/work-queue");
    await expect(page.getByTestId("admin-work-queue")).toBeVisible();
  });

  test("employee list loads", async ({ page }) => {
    await page.goto("/admin/employees");
    await page.waitForURL("**/admin/employees");
    // PageHeader description is a static purpose line (counts live in StatsCardsRow).
    await expect(page.getByRole("heading", { name: "Karyawan", level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("employee detail loads with salary section", async ({ page }) => {
    // Navigate via API to avoid depending on employee name in the table
    const res = await page.request.get("/api/employees?pageSize=1");
    const json = await res.json();
    const empId = json.data?.[0]?.id;
    if (!empId) return;
    await page.goto(`/admin/employees/${empId}`);
    await page.waitForURL(`**/admin/employees/${empId}`);
    // Dossier layout (2026-09-26): single scroll, sections open by default.
    await expect(page.locator("#profile")).toBeVisible();
    await expect(page.locator("#salary").getByText("Gaji Pokok")).toBeVisible();
  });

  test("attendance page loads", async ({ page }) => {
    await page.goto("/admin/employee-attendance");
    await page.waitForURL("**/admin/employee-attendance");
    await expect(page.locator("text=Kehadiran Hari Ini")).toBeVisible();
  });

  test("monthly attendance grid loads", async ({ page }) => {
    await page.goto("/admin/employee-attendance/monthly");
    await expect(page.locator("text=Kehadiran Bulanan")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Pilih sel untuk menimpa status kehadiran")).toBeVisible();
  });

  test("payroll list loads", async ({ page }) => {
    await page.goto("/admin/payroll");
    await page.waitForURL("**/admin/payroll");
    await expect(page.getByRole("heading", { name: /Penggajian/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("settings pages load", async ({ page }) => {
    await page.goto("/admin/settings/campuses");
    await page.waitForURL("**/admin/settings/campuses");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/admin/settings/holidays");
    await page.waitForURL("**/admin/settings/holidays");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/admin/salary-components");
    await page.waitForURL("**/admin/salary-components");
    await expect(page.locator("text=Gaji Pokok")).toBeVisible({ timeout: 15_000 });
  });

  test("can open create employee dialog from list", async ({ page }) => {
    await page.goto("/admin/employees");
    await page.waitForURL("**/admin/employees");
    await page.getByRole("button", { name: /Tambah/ }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Tambah Karyawan" })).toBeVisible({ timeout: 15_000 });
  });

  test("legacy assessment URLs redirect to the consolidated penilaian monitor", async ({ page }) => {
    // Penilaian consolidation: legacy AssessmentTemplate/StudentAssessment
    // admin surfaces retired → all redirect to /admin/assessments. The page
    // files were deleted in the 2026-07-31 retirement cycle, so this rule is
    // now the only thing standing between an old bookmark and a 404.
    //
    // 2026-09-25: the monitor itself was renamed /admin/penilaian →
    // /admin/assessments, so the old /admin/assessments/:path* legacy alias
    // (which used to redirect elsewhere) was retired — that slug is now the
    // live route. The remaining legacy alias is /admin/assessment-templates.
    await page.goto("/admin/assessment-templates");
    await expect(page).toHaveURL("/admin/assessments");
    await expect(page.getByRole("heading", { name: "Pemantauan" })).toBeVisible();
  });

  test("program deactivate sets status INACTIVE and hides from Aktif filter", async ({ page }) => {
    // Pick an ACTIVE program via API so we don't depend on seed ordering
    const list = await page.request.get("/api/programs");
    const programs = await list.json();
    const target = (programs as Array<{ id: string; name: string; status: string }>)
      .find(p => p.status === "ACTIVE");
    if (!target) {
      test.skip(true, "No ACTIVE program to deactivate");
      return;
    }

    const put = await page.request.put(`/api/programs/${target.id}`, {
      data: { status: "INACTIVE" },
    });
    expect(put.ok()).toBeTruthy();

    // Verify list under Aktif filter no longer includes it
    const after = await page.request.get("/api/programs");
    const afterJson = await after.json();
    const stillActive = (afterJson as Array<{ id: string; status: string }>)
      .find(p => p.id === target.id && p.status === "ACTIVE");
    expect(stillActive).toBeUndefined();

    // Restore to ACTIVE so other tests / subsequent runs stay idempotent
    await page.request.put(`/api/programs/${target.id}`, {
      data: { status: "ACTIVE" },
    });
  });

  test("class-section deactivate sets status INACTIVE and hides from Aktif filter", async ({ page }) => {
    const list = await page.request.get("/api/class-sections");
    const sections = await list.json();
    const target = (sections as Array<{ id: string; name: string; status: string }>)
      .find(s => s.status === "ACTIVE");
    if (!target) {
      test.skip(true, "No ACTIVE class section to deactivate");
      return;
    }

    const put = await page.request.put(`/api/class-sections/${target.id}`, {
      data: { status: "INACTIVE" },
    });
    expect(put.ok()).toBeTruthy();

    const after = await page.request.get("/api/class-sections");
    const afterJson = await after.json();
    const stillActive = (afterJson as Array<{ id: string; status: string }>)
      .find(s => s.id === target.id && s.status === "ACTIVE");
    expect(stillActive).toBeUndefined();

    // Restore to ACTIVE so other tests / subsequent runs stay idempotent
    await page.request.put(`/api/class-sections/${target.id}`, {
      data: { status: "ACTIVE" },
    });
  });

  test("student-attendance override updates status; void flips isVoided and hides row", async ({ page }) => {
    const list = await page.request.get("/api/student-attendance?mode=list&pageSize=100");
    const json = await list.json();
    const target = (json.data as Array<{ id: string; status: string; notes: string | null }> | undefined)?.[0];
    if (!target) {
      test.skip(true, "No student-attendance record available");
      return;
    }

    // Flip status via override (PUT) — pick a different status than current
    const nextStatus = target.status === "PRESENT" ? "SICK" : "PRESENT";
    const put = await page.request.put(`/api/student-attendance/${target.id}`, {
      data: { status: nextStatus, notes: "e2e override" },
    });
    expect(put.ok()).toBeTruthy();
    const putJson = await put.json();
    expect(putJson.status).toBe(nextStatus);

    // Restore original status/notes so subsequent runs stay idempotent
    await page.request.put(`/api/student-attendance/${target.id}`, {
      data: { status: target.status, notes: target.notes },
    });

    // Void (DELETE) — should flip isVoided and hide from list
    const del = await page.request.delete(`/api/student-attendance/${target.id}`);
    expect(del.ok()).toBeTruthy();

    const after = await page.request.get("/api/student-attendance?mode=list&pageSize=100");
    const afterJson = await after.json();
    const stillVisible = (afterJson.data as Array<{ id: string }> | undefined)
      ?.find(r => r.id === target.id);
    expect(stillVisible).toBeUndefined();

    // Un-void directly via prisma is not available here; record stays voided.
    // Idempotency: the next run picks a different first record (page size 100
    // surfaces plenty of alternates), and a voided record is a realistic state
    // for the list to handle.
  });

  test("payroll detail shows employee lines", async ({ page }) => {
    await page.goto("/admin/payroll");
    const payrollLink = page.locator("a[href*='/admin/payroll/']").first();
    if (await payrollLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await payrollLink.click();
      await page.waitForURL("**/admin/payroll/**");
      await expect(page.getByRole("heading").first()).toBeVisible();
    }
  });

  test("payroll DRAFT run can be edited; non-DRAFT returns 409", async ({ page }) => {
    // API-level coverage — pick a DRAFT and a non-DRAFT run (if any) from the list.
    const listRes = await page.request.get("/api/payroll?pageSize=50");
    if (!listRes.ok()) return;
    const list = await listRes.json();
    const runs: Array<{ id: string; status: string; periodStart: string; periodEnd: string; actualWorkDays: number }> =
      list.data ?? [];

    const draft = runs.find((r) => r.status === "DRAFT");
    if (draft) {
      // Happy path — edit actualWorkDays (no period shift → avoids overlap guard).
      const nextDays = (draft.actualWorkDays ?? 0) + 1;
      const put = await page.request.put(`/api/payroll/${draft.id}`, {
        data: { actualWorkDays: nextDays },
      });
      expect(put.ok()).toBe(true);
      const after = await put.json();
      expect(after.actualWorkDays).toBe(nextDays);

      // Restore original value so re-runs stay idempotent.
      await page.request.put(`/api/payroll/${draft.id}`, {
        data: { actualWorkDays: draft.actualWorkDays },
      });
    }

    const nonDraft = runs.find((r) => r.status !== "DRAFT");
    if (nonDraft) {
      // Negative path — non-DRAFT rejects edit with 409, UI hides Edit button.
      const put = await page.request.put(`/api/payroll/${nonDraft.id}`, {
        data: { actualWorkDays: (nonDraft.actualWorkDays ?? 0) + 1 },
      });
      expect(put.status()).toBe(409);

      await page.goto(`/admin/payroll/${nonDraft.id}`);
      await page.waitForURL(`**/admin/payroll/${nonDraft.id}`);
      await expect(page.getByTestId("payroll-edit-btn")).toHaveCount(0);
    }
  });

  test("admission status transitions follow the state machine", async ({ page }) => {
    // Find an INQUIRY admission to exercise the happy-path + illegal-jump guard
    const list = await page.request.get("/api/admissions?status=INQUIRY&pageSize=1");
    expect(list.ok()).toBeTruthy();
    const json = await list.json();
    const target = json.data?.[0] as { id: string; status: string } | undefined;
    if (!target) {
      test.skip(true, "No INQUIRY admission available");
      return;
    }

    // Happy-path: INQUIRY → VISIT_SCHEDULED is allowed
    const advance = await page.request.put(`/api/admissions/${target.id}`, {
      data: { status: "VISIT_SCHEDULED" },
    });
    expect(advance.ok()).toBeTruthy();
    const advanced = await advance.json();
    expect(advanced.status).toBe("VISIT_SCHEDULED");

    // Negative: VISIT_SCHEDULED → ADMITTED skips the VISITED step and must return 400.
    // (Post-cycle-2026-05-12 the REGISTERED state was dropped; ADMITTED is still a
    // valid enum value but is not in VALID_TRANSITIONS["VISIT_SCHEDULED"], so the
    // server's transition gate rejects with the same "Invalid status transition" error.)
    const skip = await page.request.put(`/api/admissions/${target.id}`, {
      data: { status: "ADMITTED" },
    });
    expect(skip.status()).toBe(400);
    const skipJson = await skip.json();
    expect(String(skipJson.error)).toMatch(/Invalid status transition/i);

    // Restore original status so subsequent runs stay idempotent.
    // INQUIRY is not in allowed[VISIT_SCHEDULED], so we go VISIT_SCHEDULED → CANCELLED
    // only as a last resort; prefer idempotent restore via direct DB is unavailable.
    // Instead, leave the row at VISIT_SCHEDULED — the test seeks "an INQUIRY row"
    // and the seed ships multiple; subsequent runs will pick the next INQUIRY row.
  });

  test("invoice void flips status to CANCELLED", async ({ page }) => {
    // Find a DRAFT or SENT invoice to void (server accepts either)
    const list = await page.request.get("/api/invoices?status=DRAFT&pageSize=1");
    expect(list.ok()).toBeTruthy();
    const json = await list.json();
    const target = json.data?.[0] as { id: string; status: string } | undefined;
    if (!target) {
      test.skip(true, "No DRAFT invoice available to void");
      return;
    }

    const res = await page.request.post(`/api/invoices/${target.id}/void`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Confirm the invoice is now CANCELLED
    const detail = await page.request.get(`/api/invoices/${target.id}`);
    expect(detail.ok()).toBeTruthy();
    const detailJson = await detail.json();
    expect(detailJson.status).toBe("CANCELLED");

    // Void is non-reversible via API (matches T4 pattern — consumes head of DRAFT list
    // across runs; seed ships enough DRAFT invoices that this is safe in practice).
  });

  test("admin can open Buku Penghubung template config and monitoring", async ({ page }) => {
    await page.goto("/admin/student-journal");
    await expect(page.getByRole("heading", { name: /Buku Penghubung/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "Sekolah" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Rumah" })).toBeVisible();

    await page.goto("/admin/student-journal/monitoring");
    await page.waitForURL("**/admin/student-journal/monitoring");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
  });

  // Roll-forward smoke (academic-hierarchy-refactor Task 9). The seed ships a
  // single academic year ("2025/2026") so a meaningful roll-forward needs a
  // distinct target year — we create one via the API in setup, then trigger
  // the "Salin Kelas ke Tahun Ini" row action on it, picking the seed year as
  // source. Focused smoke: assert the success toast, not exact counts.
  test("academic-year roll-forward clones source sections into a fresh target year", async ({ page }) => {
    // Source year — the seed's ACTIVE year with ACTIVE class sections.
    const yearsRes = await page.request.get("/api/academic-years");
    expect(yearsRes.ok()).toBeTruthy();
    const years = (await yearsRes.json()) as Array<{ id: string; name: string; status: string }>;
    const sourceYear = years.find((y) => y.status === "ACTIVE") ?? years[0];
    if (!sourceYear) {
      test.skip(true, "No academic year in seed");
      return;
    }

    // Create a distinct target year via the API. Unique name keyed on Date.now()
    // so re-runs never collide on the year-name unique constraint.
    const targetName = `E2E Roll ${Date.now()}`;
    const createRes = await page.request.post("/api/academic-years", {
      data: { name: targetName, startDate: "2027-07-01", endDate: "2028-06-30" },
    });
    expect(createRes.ok()).toBeTruthy();
    const targetYear = (await createRes.json()) as { id: string; name: string };
    expect(targetYear.id).toBeTruthy();

    await page.goto("/admin/academic-years");
    await expect(page.getByRole("heading", { name: "Tahun Ajaran", level: 1 })).toBeVisible({ timeout: 15_000 });

    // Wait for the academic-years fetch to settle so the new row is rendered.
    await page
      .waitForResponse((res) => res.url().includes("/api/academic-years") && res.ok(), { timeout: 15_000 })
      .catch(() => undefined);

    // Find the target year's row, open its row-actions menu, click the
    // roll-forward action.
    const targetRow = page.getByRole("row").filter({ hasText: targetName });
    await expect(targetRow).toBeVisible({ timeout: 10_000 });
    await targetRow.getByRole("button", { name: /Aksi untuk|Buka menu/i }).click();
    await page.getByRole("menuitem", { name: /Salin Kelas ke Tahun Ini/i }).click();

    // Roll-forward dialog: pick the source year, submit.
    const dialog = page.getByRole("dialog", { name: /Salin Kelas ke Tahun Ajaran/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: sourceYear.name }).click();
    await dialog.getByRole("button", { name: /^Salin Kelas$/ }).click();

    // Outcome toast. The roll-forward POST clones each source section AND
    // generates its ClassSession rows synchronously (reconcileSessions per
    // section) — against the live DB that is a multi-second request, so the
    // toast can take a while to land. Timeout is 60s (mirrors the bulk-retry
    // orchestration test's ceiling in this file). Copy is one of:
    //   • "N kelas digulir ke <year>"           — sections cloned (page.tsx:206)
    //   • "... kelas dilewati (sudah ada)"       — tracks already rolled
    //   • "Tidak ada kelas aktif yang bisa digulir ..." — nothing to roll
    // All three confirm the action executed end-to-end; assert on the union.
    await expect(
      page.getByText(/kelas digulir ke|kelas dilewati|Tidak ada kelas aktif/i),
    ).toBeVisible({ timeout: 60_000 });
  });
});

// ----------------------------------------------------------------------
// Tagihan: bulk-create, manual-create, retry — task 15 of cycle
// 2026-04-25-tagihan-fixes-async-bulk-manual-create.
//
// Demo-mode constraints encountered + how the suite resolved them:
//
// 1) `lib/xendit/client.ts:19` throws when `XENDIT_SECRET_KEY` is unset.
//    Resolution: `playwright.config.ts` injects a stub key so the helper
//    attempts the call instead of failing pre-flight.
//
// 2) The cycle plan suggested `page.route()` to intercept `POST
//    https://api.xendit.co/sessions`, but `page.route()` only sees
//    requests issued by the BROWSER. The Xendit fetch happens on the
//    Next.js server side — Playwright cannot intercept it. So with the
//    stub key, every Xendit call hits the real api.xendit.co and gets a
//    401 (or, in network-isolated CI, a connection error). Either way,
//    the route handler treats this as a Xendit failure and lands the
//    invoice in `PENDING_PAYMENT_LINK` with `paymentLinkError` set.
//
// 3) This means the suite only deterministically exercises the FAILURE
//    path — which is exactly the new code surface this cycle introduces
//    (PENDING_PAYMENT_LINK status, paymentLinkError column, retry
//    affordances). The success path (Xendit returns 200, status flips to
//    SENT) is covered by Vitest unit tests with a mocked
//    `createXenditSessionForInvoice` (see `app/api/__tests__/
//    invoices-generate-batch.test.ts`, `invoices-manual-create.test.ts`,
//    `xendit-create-session.test.ts`).
//
// Each test uses a unique `periodLabel` keyed on `Date.now()` so the
// plan endpoint always sees fresh eligible students. Tests share a real
// Postgres DB; writes are scoped per-period to avoid collision.
// ----------------------------------------------------------------------

test.describe("Admin tagihan flows (bulk + manual + retry)", () => {
  test.beforeEach(async ({ page }) => {
    // CI seeds `u_super_admin`; local dev DBs may have a different super-admin
    // id. Resolve dynamically so the suite is portable across both. Demo-mode
    // exposes the user list at /api/auth/users (no auth required).
    let adminId = ADMIN_USER_ID;
    try {
      const res = await page.request.get("/api/auth/users");
      if (res.ok()) {
        const users = (await res.json()) as Array<{ id: string; role: string }>;
        const exact = users.find((u) => u.id === ADMIN_USER_ID);
        if (!exact) {
          const fallback = users.find((u) => u.role === "SUPER_ADMIN");
          if (fallback) adminId = fallback.id;
        }
      }
    } catch {
      // Fall through to default — beforeEach assertions will surface auth failures.
    }
    await page.context().addCookies([{
      name: "school-erp-session",
      value: adminId,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
  });

  // Bulk-generate is the Billing Run wizard since Task T10 retired the
  // three-field "Buat Tagihan Bulanan" dialog and its /plan + /batch routes
  // (docs/cycles/2026-08-14-billing-run-wizard.md). This walks all three
  // steps: scope one class (step 1) → draft materializes rows (step 2) →
  // totals resolve (step 3). It stops short of committing on purpose — see
  // the note at the commit button below. Selectors were read directly off
  // components/admin/invoices/billing-run-wizard/*.tsx and
  // components/admin/class-section-picker.tsx, not guessed.
  test("scope one class → draft materializes rows → step 3 totals resolve", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/admin/invoices");
    await expect(page.getByRole("heading", { name: /^Tagihan$/ })).toBeVisible({ timeout: 15_000 });

    // Wait for the academic-years fetch to settle so step 1's default
    // academic-year select is populated (computeDefaultBillingForm needs
    // `years` — billing-defaults.ts).
    await page
      .waitForResponse((res) => res.url().includes("/api/academic-years") && res.ok(), { timeout: 15_000 })
      .catch(() => undefined);

    // Resolve a class section with at least one active enrollment via the
    // API first, rather than picking blind in the UI — an empty class would
    // produce a zero-row draft. This suite runs no seed-conditional skips
    // (`/ship`'s soft-skip delta check blocks any net increase), so a
    // missing fixture must fail loudly, not be routed around.
    const classesRes = await page.request.get("/api/class-sections?yearStatus=ACTIVE,PLANNING");
    expect(classesRes.ok()).toBeTruthy();
    const classSections = (await classesRes.json()) as Array<{
      id: string;
      name: string;
      _count: { enrollments: number };
      academicYearId: string;
      academicYear: { name: string };
    }>;
    const targetClass = classSections
      .filter((c) => c._count?.enrollments > 0)
      .sort((a, b) => b._count.enrollments - a._count.enrollments)[0];
    expect(
      targetClass,
      "no class section with an active enrollment on this DB — cannot scope a billing run",
    ).toBeTruthy();

    // Step 1 — Scope (step-1-scope.tsx). "Buat Tagihan" is the sole
    // bulk-generate entry point since Task T10; it opens the wizard dialog
    // titled "Buat Tagihan (Wizard)" (billing-run-wizard.tsx).
    await page.getByRole("button", { name: /^Buat Tagihan$/ }).click();

    const dialog = page.getByRole("dialog", { name: /Buat Tagihan \(Wizard\)/ });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Periode/jatuh tempo/tahun ajaran default via computeDefaultBillingForm;
    // only periode needs a unique value so this run never collides with
    // another test's or a prior leaked run's period.
    const period = `E2E Wizard ${Date.now()}`;
    await dialog.getByPlaceholder("April 2026").fill(period);
    // Several active/planning years may coexist. Scope the billing year to
    // the discovered class instead of assuming the default year owns it.
    await dialog.getByRole("combobox", { name: "Tahun Ajaran" }).click();
    await page.getByRole("option", { name: targetClass.academicYear.name, exact: true }).click();

    // Class multi-select (ClassSectionMultiPicker). Its Popover/Command list
    // portals to document.body — same as the manual-create combobox further
    // below in this file — so the search input and options are scoped to
    // `page`, not `dialog`. Trigger's accessible name is the placeholder
    // ("Pilih kelas...") until a class is selected.
    await dialog.getByRole("combobox", { name: "Pilih kelas..." }).click();
    const classSearch = page.getByPlaceholder("Cari kelas...");
    await expect(classSearch).toBeVisible({ timeout: 5_000 });
    await classSearch.fill(targetClass.name);
    // Class names can repeat across academic years; cmdk's value includes
    // the class ID, so select the exact API result after searching by name.
    const targetClassOption = page.locator(`[role="option"][data-value$=" ${targetClass.id}"]`);
    await expect(targetClassOption).toBeVisible();
    await targetClassOption.click();
    // Multi-select deliberately keeps the popover open on select (admins
    // toggle several classes in a row) — close it explicitly.
    await page.keyboard.press("Escape");

    await dialog.getByRole("button", { name: /^Lanjutkan$/ }).click();

    // A leftover DRAFT from a prior/aborted run is a real possibility on
    // this shared DB (cycle doc Assumption 3: one open draft per tenant).
    // The wizard surfaces a resume-or-discard panel instead of silently
    // creating a second draft — discard it and retry with this test's own
    // scope rather than resuming an unrelated run. "Buang & Mulai Baru"
    // re-creates and advances straight to step 2 on success.
    const conflictTitle = dialog.getByText(/Sudah ada draf tagihan/);
    const reviewHeading = dialog.getByRole("heading", { name: /Langkah 2: Tinjau/ });
    await expect(conflictTitle.or(reviewHeading)).toBeVisible({ timeout: 20_000 });
    if (await conflictTitle.isVisible()) {
      await dialog.getByRole("button", { name: /^Buang & Mulai Baru$/ }).click();
      await expect(reviewHeading).toBeVisible({ timeout: 20_000 });
    }

    // Step 2 — Review (step-2-review.tsx). Rows are materialized
    // server-side (build-billing-run.ts); an EmptyState here means the
    // scoped class produced zero in-scope rows despite the enrollment check
    // above — a real failure, asserted rather than skipped.
    await expect(dialog.getByText(/Draf tidak menghasilkan baris tagihan/)).not.toBeVisible();
    await expect(dialog.getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });

    // Cycle B2 (docs/cycles/2026-08-14-billing-run-wizard-b2.md, Task T7):
    // expand a row, edit one line's final amount, and confirm the row total
    // re-sums to match. Selectors read directly off line-editor.tsx and
    // step-2-review.tsx, not guessed:
    //   - the row's expand button aria-label is "Tampilkan rincian tagihan
    //     {student}" while collapsed (step-2-review.tsx:154-158); a row with
    //     no materialized lines (SKIPPED_*) instead gets the disabled
    //     "Tidak ada rincian" label, so filtering on this pattern lands on a
    //     row EditableRowLines will actually mount for (PENDING/EXCLUDED).
    //   - the row total is the "font-currency" span rendered in the row
    //     header regardless of expand state (step-2-review.tsx:198-206).
    //   - the per-line edit trigger's aria-label is "Edit baris
    //     {labelSnapshot}" (line-editor.tsx:650).
    //   - the amount field is labelled "Jumlah Akhir" via a real
    //     <label htmlFor> (line-editor.tsx:207-225, components/ui/field.tsx
    //     FieldLabel → components/ui/label.tsx <label>).
    // Filter on the state-INDEPENDENT part of the label. Playwright locators
    // are lazy and re-resolve on every use, so filtering on
    // /^Tampilkan rincian tagihan/ made this row stop matching the moment the
    // click below expanded it and flipped its aria-label to "Sembunyikan…" —
    // every later `editableRow.…` then resolved to nothing. That is exactly
    // how CI failed the first time this block ran. /rincian tagihan/ matches
    // both states while still excluding SKIPPED_* rows, whose expand button is
    // disabled and labelled "Tidak ada rincian".
    const editableRow = dialog
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /rincian tagihan/ }) })
      .first();
    await expect(editableRow, "no row with expandable lines in this draft").toBeVisible({
      timeout: 15_000,
    });

    const rowTotal = editableRow.locator("span.font-currency").first();
    const totalBeforeText = await rowTotal.innerText();
    const totalBefore = Number(totalBeforeText.replace(/[^\d]/g, ""));
    expect(Number.isFinite(totalBefore), `unparsable row total "${totalBeforeText}"`).toBe(true);

    await editableRow.getByRole("button", { name: /^Tampilkan rincian tagihan/ }).click();

    const editButton = editableRow.getByRole("button", { name: /^Edit baris / }).first();
    await expect(editButton, "expanded row has no editable line — not PENDING/EXCLUDED").toBeVisible({
      timeout: 10_000,
    });
    await editButton.click();

    const editDialog = page.getByRole("dialog", { name: /Edit Baris Tagihan/ });
    await expect(editDialog).toBeVisible({ timeout: 10_000 });

    const amountInput = editDialog.getByLabel("Jumlah Akhir");
    // RupiahInput shows grouped thousands ("850.000"), so read the digits.
    const currentAmount = Number((await amountInput.inputValue()).replace(/[^\d]/g, ""));
    expect(Number.isFinite(currentAmount), "unparsable line amount input value").toBe(true);
    const delta = 1_000; // distinct from the current value; always legal (increase, never negative)
    const nextAmount = currentAmount + delta;
    await amountInput.fill(String(nextAmount));
    await editDialog.getByRole("button", { name: /^Simpan$/ }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 10_000 });

    // BillingRunRow.totalDue is re-summed server-side on every line mutation
    // (Spec acceptance) and handleLineUpdated (step-2-review.tsx) patches the
    // response straight into rowsPage state — the row total must move by
    // exactly the edit's delta, with no page reload.
    await expect(rowTotal).toHaveText(`Rp ${(totalBefore + delta).toLocaleString("id-ID")}`, {
      timeout: 10_000,
    });

    await dialog.getByRole("button", { name: /^Lanjutkan$/ }).click();

    // Step 3 — Commit (step-3-commit.tsx). The commit button's label
    // carries the live PENDING count ("Komit N Tagihan") — if it never
    // appears, every row in the scoped class skipped (already invoiced this
    // period, or no fee structure), which is again a real failure for this
    // DB's state, not a reason to skip the assertion.
    await expect(dialog.getByRole("heading", { name: /Langkah 3: Komit/ })).toBeVisible({ timeout: 10_000 });
    const commitButton = dialog.getByRole("button", { name: /^Komit \d+ Tagihan$/ });
    await expect(commitButton).toBeVisible({ timeout: 15_000 });

    // STOP HERE — deliberately do NOT click commit.
    //
    // The first CI run of this spec did commit, and it broke two downstream
    // specs: parent.spec.ts expects the seeded parent to read "Lunas semua",
    // and committing real invoices for a scoped class gives one of that
    // parent's children an outstanding balance. payment.spec.ts's invoice
    // detail shim failed for the same reason. Tests share one database and
    // run in file order, so a spec that writes billing rows silently changes
    // the world every later spec observes.
    //
    // Reaching step 3 with a live "Komit N Tagihan" button already proves
    // what this spec is for: the wizard walks, the draft materialized real
    // rows server-side, and the totals resolved. The commit path itself is
    // covered by 21 route tests in app/api/__tests__/billing-runs-commit.test.ts
    // — including the atomic row claim, verbatim amounts, and the
    // already-invoiced skip — which is the right place for it. Business
    // logic belongs in vitest per the testing-gate policy; Playwright is the
    // lean cross-module smoke.
    const commitLabel = await commitButton.textContent();
    expect(commitLabel).toMatch(/Komit \d+ Tagihan/);

    // Leave no open DRAFT behind: the one-draft-per-tenant rule would make
    // the next run — this suite's or a human's — open on a conflict panel.
    const draftsRes = await page.request.get("/api/billing-runs?status=DRAFT");
    expect(draftsRes.ok()).toBeTruthy();
    const drafts = (await draftsRes.json()) as { data: Array<{ id: string; periodLabel: string }> };
    const mine = drafts.data.find((d) => d.periodLabel === period);
    expect(mine, "the draft this test created should be listed as DRAFT").toBeTruthy();
    const cancelRes = await page.request.patch(`/api/billing-runs/${mine!.id}`, {
      data: { status: "CANCELLED" },
    });
    expect(cancelRes.ok()).toBeTruthy();
  });

  test("retry-payment-links endpoint validates payload", async ({ page }) => {
    // Smoke-test the retry endpoint contract — independent of Xendit state.
    // Empty body → retry-all PENDING for tenant, returns the expected shape.
    const res = await page.request.post("/api/invoices/retry-payment-links", { data: {} });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    // Either the helper finds candidates or it short-circuits — both are
    // valid; assert keys are present.
    expect(json).toHaveProperty("retried");
    expect(json).toHaveProperty("succeeded");
    expect(json).toHaveProperty("stillFailed");
    expect(json).toHaveProperty("results");

    // Validation: invoiceIds.length > 25 → 400 from retryPaymentLinksSchema.
    const tooMany = Array.from({ length: 26 }, (_, i) => `inv_${i}`);
    const tooManyRes = await page.request.post("/api/invoices/retry-payment-links", {
      data: { invoiceIds: tooMany },
    });
    expect(tooManyRes.status()).toBe(400);
  });

  // T2c happy path — exercises the new shadcn <Command> combobox student
  // picker (no upfront pageSize=500 fetch, debounced search, idle/loading/
  // empty/error states). Cycle: 2026-04-26-finance-robustness-a-b-c.
  test("manual create dialog: combobox search → select student → submit → toast", async ({ page }) => {
    // Resolve a real student name + initial letter from the API. Using the
    // first letter of the seed-name guarantees at least one match.
    const studentsRes = await page.request.get(
      "/api/students?status=ACTIVE&pageSize=1",
    );
    const studentsJson = await studentsRes.json();
    const student = studentsJson.data?.[0] as
      | { id: string; name: string }
      | undefined;
    if (!student) {
      test.skip(true, "No ACTIVE student available");
      return;
    }
    const firstLetter = student.name.slice(0, 1);

    const feesRes = await page.request.get("/api/fee-components");
    const fees = (await feesRes.json()) as Array<{
      id: string;
      label: string;
      status: string;
      isEnabled: boolean;
    }>;
    const fee = fees.find((f) => f.status === "ACTIVE" && f.isEnabled);
    if (!fee) {
      test.skip(true, "No active fee component available");
      return;
    }

    await page.goto("/admin/invoices");
    await expect(
      page.getByRole("heading", { name: /^Tagihan$/ }),
    ).toBeVisible({ timeout: 15_000 });

    // The header has "Buat Tagihan" (opens the Billing Run wizard — the only
    // bulk path since Task T10) and "Tagihan Manual" (single invoice).
    await page.getByRole("button", { name: /^Tagihan Manual$/ }).click();

    const dialog = page.getByRole("dialog", { name: /Tagihan Manual/ });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Combobox trigger shows placeholder until selection lands.
    const trigger = dialog.getByRole("combobox").first();
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("Pilih siswa...");
    await trigger.click();

    // Type the first letter to drive the debounced /api/students fetch.
    // The combobox PopoverContent renders in a portal at document.body —
    // OUTSIDE the dialog's DOM subtree. Scope the search input + result
    // options to `page`, not `dialog`, otherwise the locators resolve to
    // zero matches and time out.
    const search = page.getByPlaceholder("Cari nama siswa...");
    await expect(search).toBeVisible({ timeout: 5_000 });
    await search.fill(firstLetter);

    // Wait for the debounced fetch + render. The result list contains an
    // item with the student's full name; click it.
    const studentItem = page
      .getByRole("option")
      .filter({ hasText: student.name })
      .first();
    await expect(studentItem).toBeVisible({ timeout: 5_000 });
    await studentItem.click();

    // Trigger now reflects the selection (name · NIS or just name).
    await expect(trigger).toContainText(student.name);

    // Fill periodLabel + line item, then submit.
    const period = `E2E Combobox ${Date.now()}`;
    await dialog.getByPlaceholder("April 2026").fill(period);

    // The fee-component combobox is the 2nd combobox in the dialog (1st = siswa).
    // We no longer filter by "Pilih komponen" placeholder text because the form
    // now pre-fills line[0].feeComponentId with the first ACTIVE component
    // (fixes a two-click-to-commit bug in Base UI Select). Open the dropdown
    // and click the desired fee option to lock in the test's specific choice.
    const feeSelect = dialog.getByRole("combobox").nth(1);
    await feeSelect.click();
    await page.getByRole("option", { name: fee.label }).first().click();

    // T8 date/money sweep: the amount field is now RupiahInput (a
    // text/numeric input, not `<input type="number">`), so it no longer has
    // role=spinbutton. Its <FieldLabel htmlFor> is "Jumlah 1" (line index 0)
    // — a real <label>, robust the same way role=spinbutton was, and unlike
    // `dialog.getByPlaceholder("0")` unaffected by Radix Select's portaled
    // SelectContent occasionally shadowing the dialog's locator scope after
    // the fee-component dropdown round trip.
    await dialog.getByLabel("Jumlah 1").fill("75000");

    await dialog.getByRole("button", { name: /^Buat Tagihan$/ }).click();

    // Real Xendit fails in test env so we expect either the success toast
    // or the warning toast — both indicate the invoice was created.
    await expect(
      page.getByText(/Tagihan dibuat( tapi link gagal)?/),
    ).toBeVisible({ timeout: 30_000 });
  });
});
