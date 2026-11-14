import { test, expect, Page } from "@playwright/test";

// Verifies the canonical admin form-dialog contract from
// docs/cycles/archive/2026-05-03-admin-modal-form-audit.md:
// - "Tambah <Entity>" trigger opens a dialog whose submit label matches
// - Cancel button labeled "Batal" with variant="ghost"
// - On mobile viewport, the overlay renders as a Sheet (not a Dialog)
// - Required fields show the asterisk via FieldLabel `required` prop

const ADMIN_USER_ID = "u_super_admin";
const DESKTOP = { width: 1280, height: 800 } as const;
const MOBILE = { width: 390, height: 844 } as const;

async function loginAsAdmin(page: Page) {
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
}

type DialogCheck = {
  name: string;
  path: string;
  triggerLabel: string;
  expectedTitle: RegExp;
  expectedSubmit: RegExp;
};

// Dialogs reachable from a list-page primary trigger (no nested navigation,
// no entity preconditions). Guardians list is edit-only — no create
// trigger lives there, so it's not enumerated. Detail-page dialogs
// (payment record, add-guardian on student detail, etc.) are out of
// scope — they need an entity to exist first.
const DIALOG_CHECKS: DialogCheck[] = [
  {
    name: "students-create",
    path: "/admin/students",
    triggerLabel: "Tambah Siswa",
    expectedTitle: /Tambah Siswa/i,
    expectedSubmit: /Tambah Siswa/i,
  },
  {
    name: "admissions-create",
    path: "/admin/admissions",
    triggerLabel: "Catat Pertanyaan",
    expectedTitle: /Catat Pertanyaan/i,
    expectedSubmit: /Catat Pertanyaan/i,
  },
  {
    name: "settings-campuses-create",
    path: "/admin/settings/campuses",
    triggerLabel: "Tambah Kampus",
    expectedTitle: /Tambah Kampus/i,
    expectedSubmit: /Tambah Kampus/i,
  },
  {
    name: "settings-holidays-create",
    path: "/admin/settings/holidays",
    triggerLabel: "Tambah Hari Libur",
    expectedTitle: /Tambah Hari Libur/i,
    expectedSubmit: /Tambah Hari Libur/i,
  },
  {
    name: "salary-components-create",
    path: "/admin/salary-components",
    triggerLabel: "Tambah Komponen",
    expectedTitle: /Tambah Komponen/i,
    expectedSubmit: /Tambah Komponen/i,
  },
];

test.describe("Admin form dialogs — desktop", () => {
  test.use({ viewport: DESKTOP });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  for (const check of DIALOG_CHECKS) {
    test(`${check.name} dialog opens with canonical labels`, async ({ page }) => {
      await page.goto(check.path);
      await page.waitForLoadState("networkidle");

      const trigger = page.getByRole("button", { name: check.triggerLabel }).first();
      await expect(trigger).toBeVisible({ timeout: 10_000 });
      await trigger.click();

      const dialog = page.locator('[data-slot="dialog-content"]').first();
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Use data-slot selector for DialogTitle specifically — getByRole("heading")
      // would match SectionHeading <h3>s now added inside Tambah Siswa (T2 +
      // sectioned forms) and fail strict-mode against the multi-match.
      await expect(dialog.locator('[data-slot="dialog-title"]')).toContainText(check.expectedTitle);
      await expect(dialog.getByRole("button", { name: check.expectedSubmit })).toBeVisible();
      // Cancel slot — text-based locator (DialogClose wrapper varies across
      // pages: some render a Button directly, some use the base-nova
      // `render` prop, some use an inner DialogClose).
      await expect(dialog.locator('button:has-text("Batal")').first()).toBeVisible();
    });
  }
});

test.describe("Admin form dialogs — mobile renders as Sheet", () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  // Subset that uses ResponsiveFormDialog or has explicit Sheet branching.
  // Settings pages are desktop-mostly per spec assumption #3 — they keep
  // Dialog on mobile and are excluded from this Sheet assertion.
  const SHEET_CHECKS = DIALOG_CHECKS.filter(
    (c) => c.name === "students-create" || c.name === "admissions-create"
  );

  for (const check of SHEET_CHECKS) {
    test(`${check.name} opens as Sheet on mobile`, async ({ page }) => {
      await page.goto(check.path);
      await page.waitForLoadState("networkidle");

      const trigger = page.getByRole("button", { name: check.triggerLabel }).first();
      await expect(trigger).toBeVisible({ timeout: 10_000 });
      await trigger.click();

      const sheet = page.locator('[data-slot="sheet-content"]').first();
      await expect(sheet).toBeVisible({ timeout: 5_000 });

      // Dialog popup must NOT be present at the same time
      await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

      // Use data-slot selector for SheetTitle — getByRole("heading") matches
      // SectionHeading h3s nested inside the form body and fails strict-mode.
      await expect(sheet.locator('[data-slot="sheet-title"]')).toContainText(check.expectedTitle);
      await expect(sheet.getByRole("button", { name: check.expectedSubmit })).toBeVisible();
    });
  }
});

test.describe("FieldLabel required asterisk", () => {
  test.use({ viewport: DESKTOP });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Tambah Siswa surfaces a required asterisk on Nama Lengkap", async ({ page }) => {
    await page.goto("/admin/students");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Tambah Siswa" }).first().click();

    const dialog = page.locator('[data-slot="dialog-content"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The required marker is an aria-hidden span containing "*" inside the
    // FieldLabel for the Nama Lengkap field. Locate via the label text.
    const namaLabel = dialog.locator('label[data-slot="field-label"]', {
      hasText: "Nama Lengkap",
    }).first();
    await expect(namaLabel).toHaveAttribute("data-required", "true");
    const namaInput = dialog.getByRole("textbox", { name: "Nama Lengkap", exact: true });
    await expect(namaInput).toHaveAttribute("aria-required", "true");
    await expect(namaInput).toHaveAccessibleName("Nama Lengkap");
    await expect(namaLabel).toHaveAttribute("for", await namaInput.getAttribute("id") as string);
    await expect(namaLabel).not.toHaveAttribute("aria-required");
    await expect(namaLabel.locator('span[aria-hidden="true"]')).toHaveText("*");
    await expect(namaLabel.locator('span[aria-hidden="true"]')).toBeVisible();
  });
});

// Regression coverage for F-3 from docs/runbooks/2026-05-16-staging-wipe-reseed-sweep.md:
// Tambah Kelas dialog's Program combobox would silently bind the *first*
// option's programId to the new row even after the operator opened the
// listbox and Down-arrowed to a later option. The persisted ClassSection
// pointed to the wrong program; visible select text matched the chosen
// option but the saved FK did not.
test.describe("Tambah Kelas — Program combobox writes selected value", () => {
  test.use({ viewport: DESKTOP });

  // CI Playwright runs against the Vercel preview, whose DATABASE_URL points
  // at the real staging Supabase DB — so this test's create persists there.
  // Track the created id and tear it down in afterEach so cleanup runs even
  // when an assertion throws (the old inline post-assert cleanup leaked an
  // ACTIVE row + reconciled sessions on every failed run — see the
  // 2026-06-14 P3009 incident). DELETE is a soft-delete (status→INACTIVE);
  // a fully isolated preview DB is the real fix, tracked separately.
  let createdSectionId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test.afterEach(async ({ page }) => {
    if (createdSectionId) {
      await page.request
        .delete(`/api/admin/classes/${createdSectionId}`)
        .catch(() => {});
      createdSectionId = null;
    }
  });

  test("non-default Program selection persists to the new ClassSection", async ({ page }) => {
    // Need at least two active Programs to detect a "wrote the first one"
    // miswrite. Skip cleanly when the staging seed is too thin.
    const progRes = await page.request.get("/api/programs");
    if (!progRes.ok()) test.skip(true, "Programs API not reachable");
    const programs = (await progRes.json()) as Array<{ id: string; name: string; status: string }>;
    const active = programs.filter((p) => p.status === "ACTIVE");
    if (active.length < 2) test.skip(true, "Need ≥2 active programs to exercise non-default selection");

    // Pick the option that the form would NOT default-select. The bug
    // collapsed every selection back to the first option, so any non-first
    // pick reproduces it.
    const target = active[active.length - 1];

    // The Tambah Kelas dialog moved from /admin/academic-years to the new
    // /admin/classes page in the 2026-05-19 kelas-page cycle. The form lost
    // the Tahun Ajaran select (year is implicit from the list-page switcher)
    // and gained Kapasitas + Pola Slot. Kampus + Program selects still drive
    // the same FK writes the original bug-fix exercised.
    await page.goto("/admin/classes");
    await page.waitForLoadState("networkidle");

    const uniqueName = `E2E F-3 ${Date.now()}`;
    await page.getByRole("button", { name: "Tambah Kelas" }).first().click();

    const dialog = page.locator('[data-slot="dialog-content"]').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Nama Kelas — FieldLabel isn't htmlFor-bound, target by placeholder.
    await dialog.getByPlaceholder("mis. TKIT A").fill(uniqueName);

    // Kampus: first combobox in the dialog. Pick the first available option.
    const campusTrigger = dialog.locator('[role="combobox"]').nth(0);
    await campusTrigger.click();
    await page.getByRole("option").first().click();

    // Program: second combobox. Open and pick the non-default option by
    // visible text (more robust than positional keyboard navigation).
    const programTrigger = dialog.locator('[role="combobox"]').nth(1);
    await programTrigger.click();
    await page.getByRole("option", { name: target.name }).click();

    // Kelompok usia (A/B) is required since the 2026-05-20 curriculum cutover
    // promoted ageGroup from name-heuristic to an explicit column. Last
    // combobox in the dialog; pick A.
    const ageGroupTrigger = dialog.locator('[role="combobox"]').last();
    await ageGroupTrigger.click();
    await page.getByRole("option", { name: /TK A/ }).click();

    // Create-mode submit reads "Tambah Kelas" (edit mode: "Simpan Perubahan").
    await dialog.getByRole("button", { name: "Tambah Kelas" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Verify persistence via the API — visual-only text would lie if the
    // bug recurred, so re-read the row.
    const listRes = await page.request.get("/api/class-sections");
    const sections = (await listRes.json()) as Array<{ id: string; name: string; programId: string }>;
    const created = sections.find((s) => s.name === uniqueName);
    // Record the id BEFORE asserting so afterEach tears it down even if the
    // programId assertion below throws — otherwise a regression would leak
    // the row on every CI run.
    createdSectionId = created?.id ?? null;
    expect(created, `class section "${uniqueName}" should exist after create`).toBeTruthy();
    expect(created!.programId, "selected Program must persist to the new ClassSection").toBe(target.id);
  });
});
