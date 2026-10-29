import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// E2E for the school + daycare bundle price ("Harga paket sekolah + daycare") —
// docs/cycles/2026-10-29-school-daycare-bundle-price.md.
//
// A child who holds a school placement and a daycare placement is billed the SUM of the two
// programs' SPP until the admin sets a bundle price on Tarif per Program. This spec gives a seeded
// child the daycare placement, proves the sum, sets a bundle price THROUGH THE UI, proves the
// Billing Run then bills exactly that amount (whether the school class or only the daycare class is
// ticked: the run is scoped per student), then clears the price through the UI and proves the sum is
// back.
//
// Setup and the Billing Run are driven through the API (the wizard itself is covered by
// admin.spec.ts). Runs are cancelled again because only one DRAFT per tenant may exist and a
// committed run would invoice real students on this shared DB. The billed month is the LAST month of
// the academic-year window: seeded invoices only cover recent months, so nothing collides with it.
// Cleanup withdraws the daycare placement and deactivates the bundle so other specs are unaffected.

const ADMIN_USER_ID = "u_super_admin";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// A round amount that is not the seeded sum (TKIT 850.000 + Day Care 1.500.000, KB 750.000 + ...).
const BUNDLE_AMOUNT = 1_234_000;

type Year = { id: string; name: string; status: string; startDate: string; endDate: string };
type Program = { id: string; name: string; type: string; status: string };
type Component = { id: string; label: string };
type ProgramFee = { programId: string; feeComponentId: string; amount: number };
type BundlesPayload = {
  programs: Program[];
  components: Component[];
  programFees: ProgramFee[];
  bundles: Array<{ schoolProgramId: string; daycareProgramId: string; feeComponentId: string; amount: number; status: string }>;
};
type Section = {
  id: string;
  name: string;
  programId: string;
  academicYearId: string;
  status: string;
  capacity: number;
  _count: { enrollments: number };
};
type StudentRow = {
  id: string;
  name: string;
  enrollments: Array<{ id: string; classSectionId: string; classSection: { program: { type: string } } }>;
};
type RunLine = { feeComponentId: string; amount: string | number; finalAmount: string | number; adjustmentAmount: string | number };
type RunRow = {
  studentId: string;
  status: string;
  totalDue: string | number;
  programLabel: string | null;
  lines: RunLine[];
};

type Fixture = {
  year: Year;
  ym: string;
  school: Program;
  daycare: Program;
  component: Component;
  schoolFee: number;
  daycareFee: number;
  schoolSection: Section;
  daycareSection: Section;
  studentId: string;
};

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  expect(res.ok(), `GET ${url}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function allActiveStudents(request: APIRequestContext): Promise<StudentRow[]> {
  const out: StudentRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await getJson<{ data: StudentRow[]; total: number }>(
      request,
      `/api/students?status=ACTIVE&pageSize=100&page=${page}`,
    );
    out.push(...res.data);
    if (out.length >= res.total || res.data.length === 0) break;
  }
  return out;
}

async function findFixture(request: APIRequestContext): Promise<Fixture> {
  const years = await getJson<Year[]>(request, "/api/academic-years");
  const year = years.find((y) => y.status === "ACTIVE");
  expect(year, "demo seed must provide an ACTIVE academic year").toBeTruthy();
  const ym = year!.endDate.slice(0, 7);

  const bundles = await getJson<BundlesPayload>(request, `/api/fee-bundles?academicYearId=${year!.id}`);
  const feeOf = (programId: string, componentId: string) =>
    bundles.programFees.find((f) => f.programId === programId && f.feeComponentId === componentId)?.amount;
  const schools = bundles.programs.filter((p) => p.type === "SEMESTER" && p.status === "ACTIVE");
  const daycares = bundles.programs.filter((p) => p.type === "YEAR_ROUND" && p.status === "ACTIVE");
  expect(schools.length, "demo seed must provide an ACTIVE school (SEMESTER) program").toBeGreaterThan(0);
  expect(daycares.length, "demo seed must provide an ACTIVE daycare (YEAR_ROUND) program").toBeGreaterThan(0);

  const sections = await getJson<Section[]>(request, "/api/class-sections?yearStatus=ACTIVE,PLANNING");
  const usable = sections.filter((s) => s.academicYearId === year!.id && s.status === "ACTIVE");
  const students = await allActiveStudents(request);

  for (const school of schools) {
    for (const daycare of daycares) {
      const component = bundles.components.find((c) => {
        const s = feeOf(school.id, c.id);
        const d = feeOf(daycare.id, c.id);
        return s !== undefined && d !== undefined && s > 0 && d > 0;
      });
      if (!component) continue;
      const schoolSections = usable.filter((s) => s.programId === school.id);
      const daycareSection = usable.find((s) => s.programId === daycare.id && s._count.enrollments < s.capacity);
      if (schoolSections.length === 0 || !daycareSection) continue;

      for (const student of students) {
        const schoolPlacement = student.enrollments.find((e) => schoolSections.some((s) => s.id === e.classSectionId));
        if (!schoolPlacement) continue;
        // No daycare placement in any open year, and no invoice already covering the billed month
        // (another spec's SPP prepay would turn the row into SKIPPED_ALREADY_INVOICED).
        if (student.enrollments.some((e) => e.classSection.program.type === "YEAR_ROUND")) continue;
        const invoices = await getJson<{ data: Array<{ periodLabel: string; status: string }> }>(
          request,
          `/api/invoices?studentId=${student.id}&pageSize=100`,
        );
        const label = monthLabel(ym).toLowerCase();
        if (invoices.data.some((i) => i.status !== "CANCELLED" && i.periodLabel.toLowerCase().includes(label))) continue;
        return {
          year: year!,
          ym,
          school,
          daycare,
          component,
          schoolFee: feeOf(school.id, component.id)!,
          daycareFee: feeOf(daycare.id, component.id)!,
          schoolSection: schoolSections.find((s) => s.id === schoolPlacement.classSectionId)!,
          daycareSection,
          studentId: student.id,
        };
      }
    }
  }
  expect(
    null,
    "demo seed must provide a school program + daycare program that both price a recurring component, an ACTIVE class of each, and a student in the school class with no daycare placement",
  ).toBeTruthy();
  throw new Error("unreachable");
}

async function enrollDaycare(request: APIRequestContext, fx: Fixture) {
  const url = `/api/admin/classes/${fx.daycareSection.id}/enrollments`;
  let res = await request.post(url, { data: { studentId: fx.studentId } });
  if (res.status() === 409 && ((await res.json()) as { code?: string }).code === "AGE_OUT_OF_RANGE") {
    res = await request.post(url, { data: { studentId: fx.studentId, ageOverrideReason: "E2E harga paket" } });
  }
  expect(res.status(), `enroll in daycare: ${await res.text()}`).toBe(201);
}

async function withdrawDaycare(request: APIRequestContext, fx: Fixture) {
  await request.delete(`/api/admin/classes/${fx.daycareSection.id}/enrollments?studentId=${fx.studentId}`);
}

async function cancelUnfinishedRuns(request: APIRequestContext) {
  const runs = await request.get("/api/billing-runs?unfinished=true&pageSize=100");
  expect(runs.ok()).toBeTruthy();
  for (const run of (await runs.json()).data as Array<{ id: string }>) {
    await request.patch(`/api/billing-runs/${run.id}`, { data: { status: "CANCELLED" } });
  }
}

async function setBundle(request: APIRequestContext, fx: Fixture, amount: number | null) {
  const res = await request.put("/api/fee-bundles", {
    data: {
      academicYearId: fx.year.id,
      changes: [
        { schoolProgramId: fx.school.id, daycareProgramId: fx.daycare.id, feeComponentId: fx.component.id, amount },
      ],
    },
  });
  expect(res.ok(), `PUT /api/fee-bundles: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function activeBundleAmount(request: APIRequestContext, fx: Fixture): Promise<number | null> {
  const payload = await getJson<BundlesPayload>(request, `/api/fee-bundles?academicYearId=${fx.year.id}`);
  const found = payload.bundles.find(
    (b) =>
      b.schoolProgramId === fx.school.id &&
      b.daycareProgramId === fx.daycare.id &&
      b.feeComponentId === fx.component.id &&
      b.status === "ACTIVE",
  );
  return found ? found.amount : null;
}

async function createDraft(request: APIRequestContext, fx: Fixture, classSectionId: string) {
  const res = await request.post("/api/billing-runs", {
    data: {
      periodLabel: monthLabel(fx.ym),
      dueDate: `${fx.ym}-28`,
      academicYearId: fx.year.id,
      classSectionIds: [classSectionId],
      includeStudentIds: [],
      excludeStudentIds: [],
    },
  });
  expect(res.ok(), `create draft: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function rebuild(request: APIRequestContext, runId: string) {
  const res = await request.post(`/api/billing-runs/${runId}/rebuild`, { data: { confirm: true } });
  expect(res.ok(), `rebuild: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function studentRow(request: APIRequestContext, runId: string, studentId: string): Promise<RunRow> {
  const run = await getJson<{ rows: { data: Array<RunRow> } }>(request, `/api/billing-runs/${runId}?pageSize=100`);
  const row = run.rows.data.find((r) => r.studentId === studentId);
  expect(row, "the student must have a row in the draft").toBeTruthy();
  expect(row!.status, "the student's row must be billable (PENDING)").toBe("PENDING");
  return row!;
}

const sppAmount = (row: RunRow, componentId: string) => {
  const lines = row.lines.filter((l) => l.feeComponentId === componentId);
  expect(lines, "exactly one merged line for the shared component").toHaveLength(1);
  return Number(lines[0].amount);
};

/** Amounts of every line except the shared component, to prove the others are untouched. */
const otherLines = (row: RunRow, componentId: string) =>
  Object.fromEntries(
    row.lines.filter((l) => l.feeComponentId !== componentId).map((l) => [l.feeComponentId, Number(l.amount)]),
  );

const finalSum = (row: RunRow) => row.lines.reduce((sum, l) => sum + Number(l.finalAmount), 0);

async function openBundleInput(page: Page, fx: Fixture) {
  await page.goto("/admin/fees?tab=structure");
  await expect(page.getByText("Harga paket sekolah + daycare").first()).toBeVisible({ timeout: 20_000 });
  const yearTrigger = page.getByRole("combobox", { name: "Tahun Ajaran" });
  if (!(await yearTrigger.innerText()).includes(fx.year.name)) {
    await yearTrigger.click();
    await page.getByRole("option", { name: fx.year.name }).click();
  }
  const input = page.getByLabel(`Harga paket ${fx.component.label}, ${fx.school.name} + ${fx.daycare.name}`, { exact: true });
  await expect(input).toBeVisible({ timeout: 20_000 });
  return input;
}

async function saveBundleThroughUi(page: Page) {
  const save = page.getByRole("button", { name: "Simpan harga paket" });
  await expect(save).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/fee-bundles") && r.request().method() === "PUT"),
    save.click(),
  ]);
  expect(response.status(), `save bundle: ${await response.text()}`).toBe(200);
  await expect(page.getByText("Harga paket disimpan").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("Admin — harga paket sekolah + daycare", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      { name: "school-erp-session", value: ADMIN_USER_ID, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
  });

  test("set a bundle price → draft bills it for either class → clear → billed the sum again", async ({ page }) => {
    test.setTimeout(180_000);
    const api = page.request;
    const fx = await findFixture(api);
    const sum = fx.schoolFee + fx.daycareFee;
    expect(BUNDLE_AMOUNT, "the bundle must differ from the normal sum for the test to prove anything").not.toBe(sum);
    let enrolled = false;

    try {
      // Clean slate: leaked drafts from earlier runs (one DRAFT per tenant) and any stale bundle price.
      await cancelUnfinishedRuns(api);
      if ((await activeBundleAmount(api, fx)) !== null) await setBundle(api, fx, null);

      // The child holds the school placement already; add the daycare one.
      await enrollDaycare(api, fx);
      enrolled = true;

      // 1. No bundle price: the SPP line is the sum of the two programs, and the row names both.
      const draft = await createDraft(api, fx, fx.schoolSection.id);
      const before = await studentRow(api, draft, fx.studentId);
      expect(sppAmount(before, fx.component.id), "without a bundle the SPP line is school + daycare").toBe(sum);
      expect(before.programLabel).toContain(fx.school.name);
      expect(before.programLabel).toContain(fx.daycare.name);
      const othersBefore = otherLines(before, fx.component.id);
      const noAdjustment = before.lines.every((l) => Number(l.adjustmentAmount) === 0);
      expect(Number(before.totalDue)).toBe(finalSum(before));

      // 2. Set the bundle price through the UI.
      const input = await openBundleInput(page, fx);
      await input.fill(String(BUNDLE_AMOUNT));
      await saveBundleThroughUi(page);
      expect(await activeBundleAmount(api, fx), "the saved price is active on the server").toBe(BUNDLE_AMOUNT);

      // 3. Rebuilding the draft ticked on the SCHOOL class only bills exactly the bundle amount.
      await rebuild(api, draft);
      const after = await studentRow(api, draft, fx.studentId);
      expect(sppAmount(after, fx.component.id)).toBe(BUNDLE_AMOUNT);
      expect(otherLines(after, fx.component.id), "other components are unchanged").toEqual(othersBefore);
      expect(Number(after.totalDue)).toBe(finalSum(after));
      if (noAdjustment) expect(Number(after.totalDue)).toBe(Number(before.totalDue) - sum + BUNDLE_AMOUNT);

      // 4. Per-student scope: a run ticking ONLY the daycare class bills the same child the same bundle.
      await api.patch(`/api/billing-runs/${draft}`, { data: { status: "CANCELLED" } });
      const daycareDraft = await createDraft(api, fx, fx.daycareSection.id);
      const viaDaycare = await studentRow(api, daycareDraft, fx.studentId);
      expect(sppAmount(viaDaycare, fx.component.id), "daycare-only run bills the bundle, not just the daycare fee").toBe(BUNDLE_AMOUNT);
      expect(viaDaycare.programLabel).toContain(fx.school.name);
      expect(viaDaycare.programLabel).toContain(fx.daycare.name);
      expect(Number(viaDaycare.totalDue)).toBe(finalSum(viaDaycare));

      // 5. Clear the price through the UI: after a rebuild the line is the sum again.
      const clearInput = await openBundleInput(page, fx);
      await expect(clearInput).toHaveValue(/1\.234\.000/);
      await clearInput.fill("");
      await saveBundleThroughUi(page);
      expect(await activeBundleAmount(api, fx), "the cleared price is no longer active").toBeNull();

      await rebuild(api, daycareDraft);
      const restored = await studentRow(api, daycareDraft, fx.studentId);
      expect(sppAmount(restored, fx.component.id), "after clearing, the SPP line is the sum again").toBe(sum);
      expect(otherLines(restored, fx.component.id)).toEqual(othersBefore);
      await api.patch(`/api/billing-runs/${daycareDraft}`, { data: { status: "CANCELLED" } });
    } finally {
      await cancelUnfinishedRuns(api);
      if ((await activeBundleAmount(api, fx).catch(() => null)) !== null) await setBundle(api, fx, null);
      if (enrolled) await withdrawDaycare(api, fx);
    }
  });
});
