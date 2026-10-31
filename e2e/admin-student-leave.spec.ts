import { test, expect, type APIRequestContext } from "@playwright/test";

// E2E for student leave (Cuti siswa) — docs/cycles/2026-10-29-student-enrollment-leave.md.
// Admin records a leave on the student page, the Billing Run skips that placement,
// a draft built BEFORE the leave is parked as excluded until rebuilt, and cancelling
// the leave makes the next run bill the student again.
//
// Billing runs are set up through the API (the wizard itself is covered by admin.spec.ts)
// and cancelled again, because only one DRAFT per tenant may exist and a committed run
// would invoice real students on this shared DB. The leave month is the LAST month of the
// enrollment's academic-year window: seeded invoices only cover recent months, so no
// existing invoice or run collides with it.

const ADMIN_USER_ID = "u_super_admin";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

type LeavesPayload = {
  data: Array<{ id: string; enrollmentId: string; status: string }>;
  enrollments: Array<{
    id: string;
    programName: string;
    academicYearId: string;
    eligible: boolean;
    window: { from: string; to: string } | null;
  }>;
};

type Fixture = {
  studentId: string;
  enrollmentId: string;
  academicYearId: string;
  ym: string;
};

async function findFixture(request: APIRequestContext): Promise<Fixture> {
  const studentsRes = await request.get("/api/students?status=ACTIVE&pageSize=100");
  expect(studentsRes.ok(), "GET /api/students must succeed").toBeTruthy();
  const students = (await studentsRes.json()).data as Array<{ id: string }>;
  let fallback: Fixture | null = null;
  for (const s of students) {
    const res = await request.get(`/api/students/${s.id}/leaves`);
    if (!res.ok()) continue;
    const payload = (await res.json()) as LeavesPayload;
    for (const e of payload.enrollments) {
      if (!e.eligible || !e.window) continue;
      // Other specs share this database (SPP prepay settles every month of a student's year). A student
      // already invoiced for the leave month would read SKIPPED_ALREADY_INVOICED, not PENDING: pick another.
      const invoicesRes = await request.get(`/api/invoices?studentId=${s.id}&pageSize=100`);
      if (!invoicesRes.ok()) continue;
      const label = monthLabel(e.window.to).toLowerCase();
      const invoiced = ((await invoicesRes.json()).data as Array<{ periodLabel: string; status: string }>).some(
        (inv) => inv.status !== "CANCELLED" && inv.periodLabel.toLowerCase().includes(label),
      );
      if (invoiced) continue;
      const fixture = { studentId: s.id, enrollmentId: e.id, academicYearId: e.academicYearId, ym: e.window.to };
      if (/day\s*care/i.test(e.programName)) return fixture;
      fallback ??= fixture;
    }
  }
  expect(fallback, "demo seed must provide an ACTIVE student with a leave-eligible enrollment").toBeTruthy();
  return fallback!;
}

// Leaked rows from earlier runs would collide (one draft per tenant, no overlapping leaves).
async function cleanSlate(request: APIRequestContext, fx: Fixture) {
  const runs = await request.get("/api/billing-runs?unfinished=true&pageSize=100");
  expect(runs.ok()).toBeTruthy();
  for (const run of (await runs.json()).data as Array<{ id: string }>) {
    await request.patch(`/api/billing-runs/${run.id}`, { data: { status: "CANCELLED" } });
  }
  const res = await request.get(`/api/students/${fx.studentId}/leaves`);
  for (const leave of ((await res.json()) as LeavesPayload).data) {
    if (leave.status === "ACTIVE") {
      await request.put(`/api/students/${fx.studentId}/leaves/${leave.id}`, { data: { status: "INACTIVE" } });
    }
  }
}

async function createDraft(request: APIRequestContext, fx: Fixture) {
  const res = await request.post("/api/billing-runs", {
    data: {
      periodLabel: monthLabel(fx.ym),
      dueDate: `${fx.ym}-28`,
      academicYearId: fx.academicYearId,
      classSectionIds: [],
      includeStudentIds: [fx.studentId],
      excludeStudentIds: [],
    },
  });
  expect(res.ok(), `create draft: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

async function studentRow(request: APIRequestContext, runId: string, studentId: string) {
  const res = await request.get(`/api/billing-runs/${runId}?pageSize=100`);
  expect(res.ok()).toBeTruthy();
  const run = (await res.json()) as { rows: { data: Array<{ studentId: string; status: string; error: string | null }> } };
  return run.rows.data.find((r) => r.studentId === studentId);
}

async function cancelRun(request: APIRequestContext, runId: string) {
  await request.patch(`/api/billing-runs/${runId}`, { data: { status: "CANCELLED" } });
}

test.describe("Admin — student leave (cuti)", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      { name: "school-erp-session", value: ADMIN_USER_ID, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
  });

  test("record on the student page → run shows Sedang cuti → cancel → billed again", async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await findFixture(page.request);
    await cleanSlate(page.request, fx);
    const reason = `E2E cuti ${Date.now()}`;

    await page.goto(`/admin/students/${fx.studentId}#cuti`);
    await expect(page.getByRole("button", { name: "Catat cuti" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Catat cuti" }).click();

    const dialog = page.getByRole("dialog", { name: "Catat cuti" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Mulai bulan/).click();
    await page.getByRole("option", { name: monthLabel(fx.ym) }).click();
    await dialog.getByLabel(/Alasan/).fill(reason);
    await dialog.getByRole("button", { name: "Catat cuti" }).click();
    await expect(page.getByText("Cuti dicatat").first()).toBeVisible({ timeout: 15_000 });

    // The invoice follow-up only opens when the student has an open invoice for that month.
    const followUp = page.getByRole("dialog", { name: "Tagihan yang masih terbuka" });
    if (await followUp.isVisible().catch(() => false)) {
      await followUp.getByRole("button", { name: "Tutup" }).click();
    }
    await expect(page.locator("#cuti-content").getByText(reason)).toBeVisible();

    // The Billing Run now skips that placement for the covered month, with a visible reason.
    const run = await createDraft(page.request, fx);
    expect((await studentRow(page.request, run.id, fx.studentId))?.status).toBe("SKIPPED_ON_LEAVE");
    await cancelRun(page.request, run.id);

    // Cancel the leave from the page: the next run bills the student again.
    await page.getByRole("button", { name: "Batalkan cuti" }).first().click();
    await page.getByRole("button", { name: "Ya, batalkan" }).click();
    await expect(page.getByText("Dibatalkan").first()).toBeVisible({ timeout: 15_000 });

    const again = await createDraft(page.request, fx);
    const row = await studentRow(page.request, again.id, fx.studentId);
    expect(row?.status, "after cancelling, the student is billed again").not.toBe("SKIPPED_ON_LEAVE");
    await cancelRun(page.request, again.id);
  });

  test("a draft built before the leave is parked as excluded until rebuilt", async ({ page }) => {
    test.setTimeout(120_000);
    const fx = await findFixture(page.request);
    await cleanSlate(page.request, fx);

    const draft = await createDraft(page.request, fx);
    const before = await studentRow(page.request, draft.id, fx.studentId);
    expect(before?.status, "fixture student must be billable before the leave").toBe("PENDING");

    const create = await page.request.post(`/api/students/${fx.studentId}/leaves`, {
      data: { enrollmentId: fx.enrollmentId, startMonth: fx.ym, endMonth: fx.ym, reason: "E2E draf dibuat sebelum cuti" },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as { leave: { id: string }; affectedRuns: Array<{ id: string }> };
    expect(created.affectedRuns.map((r) => r.id)).toContain(draft.id);

    const parked = await studentRow(page.request, draft.id, fx.studentId);
    expect(parked?.status).toBe("EXCLUDED");
    expect(parked?.error).toContain("Cuti");

    // An overlapping leave for the same placement is refused.
    const overlap = await page.request.post(`/api/students/${fx.studentId}/leaves`, {
      data: { enrollmentId: fx.enrollmentId, startMonth: fx.ym, endMonth: fx.ym, reason: "E2E tumpang tindih" },
    });
    expect(overlap.status()).toBe(409);

    // Rebuilding applies the leave properly.
    const rebuild = await page.request.post(`/api/billing-runs/${draft.id}/rebuild`, { data: { confirm: true } });
    expect(rebuild.ok(), await rebuild.text()).toBeTruthy();
    expect((await studentRow(page.request, draft.id, fx.studentId))?.status).toBe("SKIPPED_ON_LEAVE");

    await cancelRun(page.request, draft.id);
    const cancel = await page.request.put(`/api/students/${fx.studentId}/leaves/${created.leave.id}`, {
      data: { status: "INACTIVE" },
    });
    expect(cancel.ok()).toBeTruthy();
  });
});
