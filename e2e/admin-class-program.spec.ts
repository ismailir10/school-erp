import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

// Cycle 2026-10-27-class-program-visibility (T8). A class is billed from the
// fee structure of the program it is linked to, so a wrongly linked class
// bills the wrong rate. The admin must be able to see that and fix it
// without a developer. Demo-mode cookie auth, like admin-classes.spec.ts.

const ADMIN_USER_ID = "u_super_admin";
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type Program = { id: string; name: string; code: string; status: string };
type Impact = {
  activeStudents: number;
  blockedReason: string | null;
  current: { programId: string; programName: string; fees: { total: number } };
  next: { programId: string; programName: string; fees: { total: number; lines: unknown[] } } | null;
};

async function json<T>(res: { ok(): boolean; status(): number; text(): Promise<string> }, label: string): Promise<T> {
  const body = await res.text();
  expect(res.ok(), `${label}: HTTP ${res.status()} ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
}

async function openUbahKelas(page: Page, className: string, yearId: string) {
  await page.goto(`/admin/classes?yearId=${yearId}`);
  await page.getByPlaceholder("Cari nama kelas...").fill(className);
  await page.getByRole("button", { name: new RegExp(`Aksi untuk ${className}`) }).click();
  await page.getByRole("menuitem", { name: /Ubah|Edit/ }).click();
  const dialog = page.getByRole("dialog", { name: /Ubah Kelas/ });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

async function pickProgram(page: Page, dialog: ReturnType<Page["getByRole"]>, program: Program) {
  await dialog.getByRole("combobox", { name: /Program/ }).click();
  await page.getByRole("option", { name: new RegExp(`${program.name}\\s*\\(${program.code}\\)`) }).click();
}

test.describe("Admin: class ↔ program setup", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      { name: "school-erp-session", value: ADMIN_USER_ID, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
  });

  test("an admin moves a class to the right program and sees the rate in the billing wizard", async ({ page }) => {
    const campuses = await json<{ data?: { id: string; status: string }[] } | { id: string; status: string }[]>(
      await page.request.get("/api/config/campuses?status=ACTIVE"), "campuses");
    const programs = await json<{ data?: Program[] } | Program[]>(await page.request.get("/api/programs"), "programs");
    const years = await json<{ data?: { id: string; name: string; status: string }[] } | { id: string; name: string; status: string }[]>(
      await page.request.get("/api/academic-years"), "years");
    const campus = (Array.isArray(campuses) ? campuses : campuses.data ?? []).find((c) => c.status === "ACTIVE");
    const activePrograms = (Array.isArray(programs) ? programs : programs.data ?? []).filter((p) => p.status === "ACTIVE");
    const year = (Array.isArray(years) ? years : years.data ?? []).find((y) => y.status === "ACTIVE");
    expect(campus, "needs an active campus").toBeTruthy();
    expect(year, "needs an active academic year").toBeTruthy();
    expect(activePrograms.length, "needs at least two active programs").toBeGreaterThanOrEqual(2);

    const className = `E2E Program ${randomUUID().slice(0, 6)}`;
    const created = await json<{ id: string; programId: string }>(
      await page.request.post("/api/admin/classes", {
        data: {
          campusId: campus!.id,
          programId: activePrograms[0].id,
          academicYearId: year!.id,
          name: className,
          ageGroup: "A",
          capacity: 5,
          slotTemplate: "FULL_DAY",
        },
      }),
      "create class",
    );

    try {
      // Pick a target program whose per-period fee differs from the current one.
      let target: Program | undefined;
      let impact: Impact | undefined;
      for (const p of activePrograms.slice(1)) {
        const candidate = await json<Impact>(
          await page.request.get(`/api/admin/classes/${created.id}/program-impact?programId=${p.id}`),
          "impact",
        );
        if (candidate.next && candidate.next.fees.lines.length > 0 && candidate.next.fees.total !== candidate.current.fees.total) {
          target = p;
          impact = candidate;
          break;
        }
      }
      expect(target && impact, "needs a second program with a different recurring fee").toBeTruthy();

      // Ubah Kelas: Program is editable, and the dialog says what changes.
      const dialog = await openUbahKelas(page, className, year!.id);
      await expect(dialog.getByRole("combobox", { name: /Program/ })).toBeEnabled();
      await pickProgram(page, dialog, target!);
      await expect(
        dialog.getByText(
          `Tagihan rutin per periode berubah dari ${rupiah(impact!.current.fees.total)} ke ${rupiah(impact!.next!.fees.total)} untuk 0 siswa aktif.`,
        ),
      ).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole("button", { name: "Simpan Perubahan" }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      const after = await json<{ programId: string }>(await page.request.get(`/api/admin/classes/${created.id}`), "class after");
      expect(after.programId).toBe(target!.id);

      // Billing wizard: the class now shows its new program and rate.
      await page.goto("/admin/invoices");
      await page.getByRole("button", { name: /^Buat Tagihan$/ }).click();
      const wizard = page.getByRole("dialog", { name: /Buat Tagihan \(Wizard\)/ });
      await expect(wizard).toBeVisible({ timeout: 10_000 });
      await wizard.getByRole("combobox", { name: "Tahun Ajaran" }).click();
      await page.getByRole("option", { name: year!.name, exact: true }).click();
      await wizard.getByRole("combobox", { name: "Pilih kelas..." }).click();
      await page.getByPlaceholder("Cari kelas...").fill(className);
      const option = page.locator(`[role="option"][data-value$=" ${created.id}"]`);
      await expect(option).toBeVisible({ timeout: 10_000 });
      await expect(option).toContainText(`${target!.name} · ${rupiah(impact!.next!.fees.total)} / periode`);
    } finally {
      await page.request.delete(`/api/admin/classes/${created.id}`).catch(() => {});
    }
  });

  test("a class whose students are already invoiced cannot change program, and says why", async ({ page }) => {
    const programs = await json<{ data?: Program[] } | Program[]>(await page.request.get("/api/programs"), "programs");
    const activePrograms = (Array.isArray(programs) ? programs : programs.data ?? []).filter((p) => p.status === "ACTIVE");
    const classes = await json<{ data: { id: string; name: string; programId: string; academicYearId: string; status: string; enrolledCount: number }[] }>(
      await page.request.get("/api/admin/classes?pageSize=100&status=ACTIVE"), "classes");

    // Find a class the server itself reports as blocked, rather than assuming which seeded class is invoiced.
    let blocked: { cls: (typeof classes.data)[number]; program: Program; reason: string } | undefined;
    for (const cls of classes.data.filter((c) => c.enrolledCount > 0)) {
      const other = activePrograms.find((p) => p.id !== cls.programId);
      if (!other) continue;
      const impact = await json<Impact>(
        await page.request.get(`/api/admin/classes/${cls.id}/program-impact?programId=${other.id}`), "impact");
      if (impact.blockedReason) {
        blocked = { cls, program: other, reason: impact.blockedReason };
        break;
      }
    }
    expect(blocked, "the demo seed has invoiced classes; none reported as blocked").toBeTruthy();

    const dialog = await openUbahKelas(page, blocked!.cls.name, blocked!.cls.academicYearId);
    await pickProgram(page, dialog, blocked!.program);
    await expect(dialog.getByText(blocked!.reason)).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("button", { name: "Simpan Perubahan" })).toBeDisabled();

    // The server refuses it too, whatever the UI does.
    const res = await page.request.patch(`/api/admin/classes/${blocked!.cls.id}`, { data: { programId: blocked!.program.id } });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("PROGRAM_HAS_INVOICES");
    const unchanged = await json<{ programId: string }>(await page.request.get(`/api/admin/classes/${blocked!.cls.id}`), "class unchanged");
    expect(unchanged.programId).toBe(blocked!.cls.programId);
  });
});
