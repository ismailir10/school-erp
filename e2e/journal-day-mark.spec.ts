import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";

// "Hari tanpa buku penghubung": the guru marks a class-day (swimming, an outing)
// with a keterangan; the wali reads it in that day's column. Demo-mode auth, as
// the other portal specs: discover user ids from /api/auth/users, set the cookie.

const KETERANGAN = "Renang";

/** Latest school day (Mon-Fri) that is today or earlier, in Jakarta. */
function lastSchoolDay(): { date: string; isToday: boolean } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  const date = d.toISOString().slice(0, 10);
  return { date, isToday: date === today };
}

async function userId(request: APIRequestContext, role: string): Promise<string> {
  const users = (await (await request.get("/api/auth/users")).json()) as Array<{ id: string; role: string }>;
  const user = users.find((u) => u.role === role);
  if (!user) throw new Error(`No ${role} user found in demo DB`);
  return user.id;
}

async function asUser(browser: Browser, id: string) {
  const context = await browser.newContext();
  await context.addCookies([{ name: "school-erp-session", value: id, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  return context;
}

test.describe("Hari tanpa buku penghubung", () => {
  const { date, isToday } = lastSchoolDay();

  test("guru marks a class-day from the entry page, it persists, and Hapus tanda restores the day", async ({ browser, request }) => {
    const context = await asUser(browser, await userId(request, "TEACHER"));
    const page = await context.newPage();
    const assignments = (await (await context.request.get("/api/teaching-assignments/my")).json()) as Array<{ classSectionId: string }> | { data?: Array<{ classSectionId: string }> };
    const classId = (Array.isArray(assignments) ? assignments : assignments.data ?? [])[0]?.classSectionId;
    test.skip(!classId, "teacher has no assigned classes in demo seed");

    const remove = () => context.request.delete("/api/student-journal/day-marks", { data: { classSectionId: classId, date } });
    await remove(); // start clean whatever an earlier run left behind
    try {
      await page.goto(`/teacher/student-journal/entry?classId=${classId}&date=${date}`);
      await page.getByTestId("day-mark-open").click();
      await page.getByRole("button", { name: KETERANGAN, exact: true }).click();
      await page.getByTestId("day-mark-save").click();
      await expect(page.getByTestId("day-mark-banner")).toContainText(KETERANGAN);

      // Saved on the server, not just in the page: a reload brings the banner back.
      await page.reload();
      await expect(page.getByTestId("day-mark-banner")).toContainText(KETERANGAN);

      if (isToday) {
        await page.goto("/teacher");
        const open = page.locator('[aria-labelledby="class-tasks"]').getByText(/Jurnal harian/);
        await expect(open).toHaveCount(0); // finished, so it is not listed as outstanding
      }

      await page.goto(`/teacher/student-journal/entry?classId=${classId}&date=${date}`);
      await page.getByTestId("day-mark-edit").click();
      await page.getByTestId("day-mark-remove").click();
      await expect(page.getByTestId("day-mark-banner")).toHaveCount(0);
      await expect(page.getByTestId("day-mark-open")).toBeVisible();
    } finally {
      await remove();
      await context.close();
    }
  });

  test("a wali sees the keterangan in the Jurnal week an admin marked, and only that", async ({ browser, request }) => {
    const parent = await asUser(browser, await userId(request, "GUARDIAN"));
    const admin = await asUser(browser, await userId(request, "SCHOOL_ADMIN"));
    try {
      const children = ((await (await parent.request.get("/api/parent/children")).json()) as { data: Array<{ className: string | null }> }).data;
      const classes = ((await (await admin.request.get(`/api/student-journal/admin/classes?weekStart=${date}`)).json()) as { data: Array<{ classSectionId: string; className: string }> }).data;
      const classId = classes.find((c) => c.className === children[0]?.className)?.classSectionId;
      test.skip(!classId, "the parent's child is not in a class in the demo seed");

      const put = await admin.request.put("/api/student-journal/day-marks", { data: { classSectionId: classId, date, reason: KETERANGAN } });
      expect(put.ok()).toBeTruthy();

      const page = await parent.newPage();
      await page.goto("/parent/student-journal");
      await expect(page.getByTestId("day-mark-notes")).toContainText(`Tanpa buku penghubung: ${KETERANGAN}`);

      // A wali can read it but never write it.
      const denied = await parent.request.put("/api/student-journal/day-marks", { data: { classSectionId: classId, date, reason: "Libur" } });
      expect(denied.status()).toBe(403);
    } finally {
      const classesRes = await admin.request.get(`/api/student-journal/admin/classes?weekStart=${date}`);
      const classes = ((await classesRes.json()) as { data: Array<{ classSectionId: string }> }).data;
      for (const c of classes) await admin.request.delete("/api/student-journal/day-marks", { data: { classSectionId: c.classSectionId, date } });
      await parent.close();
      await admin.close();
    }
  });
});
