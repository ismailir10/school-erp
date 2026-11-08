import { test, expect, type Page } from "@playwright/test";
import { RELEASES } from "../lib/changelog/releases";

// Apa yang Baru: signed-in only, any role. Demo-mode cookie auth, same pattern as the other specs.

type DemoUser = { id: string; role: string };
let users: DemoUser[] = [];

async function signInAs(page: Page, role: string) {
  const user = users.find((u) => u.role === role);
  if (!user) throw new Error(`No ${role} user in demo DB`);
  await page.context().addCookies([
    { name: "school-erp-session", value: user.id, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.describe("Apa yang Baru (changelog)", () => {
  test.beforeAll(async ({ request }) => {
    users = await (await request.get("/api/auth/users")).json();
  });

  test("a signed-out visitor is sent to the sign-in screen", async ({ page }) => {
    await page.goto("/changelog");
    await expect(page).toHaveURL(/localhost:3000\/$/);
  });

  for (const [role, home, back] of [
    ["SUPER_ADMIN", "/admin", "Dasbor admin"],
    ["TEACHER", "/teacher", "Beranda guru"],
    ["GUARDIAN", "/parent", "Beranda orang tua"],
  ] as const) {
    test(`${role} opens it and returns to their portal`, async ({ page }) => {
      await signInAs(page, role);
      await page.goto("/changelog");
      await expect(page.getByRole("heading", { level: 1, name: "Apa yang Baru" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await page.getByRole("link", { name: `Kembali ke ${back}` }).click();
      await page.waitForURL(`**${home}`, { timeout: 15_000 });
    });
  }

  test("an admin can read every release in order and filters return to page one", async ({ page }) => {
    await signInAs(page, "SUPER_ADMIN");
    await page.goto("/admin");
    await page.getByRole("link", { name: "Apa yang Baru" }).click();
    await page.getByRole("button", { name: "Semua", exact: true }).click();

    const titles = page.getByRole("article").getByRole("heading", { level: 2 });
    const pager = page.getByRole("navigation", { name: "Halaman pembaruan" });
    const previous = pager.getByRole("button", { name: "Sebelumnya" });
    const next = pager.getByRole("button", { name: "Berikutnya" });
    const totalPages = Math.ceil(RELEASES.length / 5);

    await expect(previous).toBeDisabled();
    for (let current = 1; current <= totalPages; current++) {
      const start = (current - 1) * 5;
      await expect(titles).toHaveText(RELEASES.slice(start, start + 5).map((release) => release.headline));
      await expect(pager.getByText(`Halaman ${current} dari ${totalPages}`, { exact: true })).toBeVisible();
      if (current > 1) await expect(titles.first()).toBeFocused();
      if (current < totalPages) await next.press("Enter");
    }

    await expect(next).toBeDisabled();
    await previous.click();
    await expect(pager.getByText(`Halaman ${totalPages - 1} dari ${totalPages}`, { exact: true })).toBeVisible();
    await expect(titles.first()).toBeFocused();

    const month = page.getByRole("combobox", { name: "Bulan" });
    await month.selectOption("2026-10");
    const october = RELEASES.filter((release) => release.id.startsWith("2026-10-"));
    await expect(titles).toHaveText(october.slice(0, 5).map((release) => release.headline));

    await next.click();
    await page.getByRole("button", { name: "Untuk admin" }).click();
    const forAdmin = october.filter(({ items }) => items.some(({ audience }) => audience === "admin" || audience === "semua"));
    await expect(month).toHaveValue("2026-10");
    await expect(titles).toHaveText(forAdmin.slice(0, 5).map((release) => release.headline));
  });

  test("a teacher combines month, module and audience on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "TEACHER");
    await page.goto("/teacher");
    await page.getByRole("navigation", { name: "Navigasi utama guru" }).getByRole("button", { name: "Lainnya" }).click();
    await page.getByRole("navigation", { name: "Menu lainnya guru" }).getByRole("link", { name: /^Apa yang Baru/ }).click();
    await expect(page.getByRole("button", { name: "Untuk guru" })).toHaveAttribute("aria-pressed", "true");

    const month = page.getByRole("combobox", { name: "Bulan" });
    const moduleSelect = page.getByRole("combobox", { name: "Modul" });
    await expect(page.getByRole("navigation", { name: "Halaman pembaruan" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const notes = page.getByRole("article").getByRole("paragraph");
    await month.selectOption({ label: "November 2026" });
    await moduleSelect.selectOption({ label: "Buku Penghubung" });

    const novemberReleases = RELEASES.filter(({ id }) => id.startsWith("2026-11-"));
    const teacherNotes = novemberReleases.map(({ items }) => items.filter(
      ({ module, audience }) => module === "buku-penghubung" && (audience === "guru" || audience === "semua"),
    )).filter((items) => items.length > 0);
    expect(teacherNotes.length).toBeGreaterThan(0);
    await expect(notes).toHaveText(teacherNotes.slice(0, 5).flat().map(({ text }) => text));

    await page.getByRole("button", { name: "Semua", exact: true }).click();
    await expect(month).toHaveValue("2026-11");
    await expect(moduleSelect).toHaveValue("buku-penghubung");
    const allNotes = novemberReleases.map(({ items }) => items.filter(
      ({ module }) => module === "buku-penghubung",
    )).filter((items) => items.length > 0);
    await expect(notes).toHaveText(allNotes.slice(0, 5).flat().map(({ text }) => text));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("a parent clears an empty month and module without changing audience", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "GUARDIAN");
    await page.goto("/changelog");

    const month = page.getByRole("combobox", { name: "Bulan" });
    const moduleSelect = page.getByRole("combobox", { name: "Modul" });
    const titles = page.getByRole("article").getByRole("heading", { level: 2 });
    const forParents = RELEASES.filter(({ items }) =>
      items.some(({ audience }) => audience === "orang-tua" || audience === "semua"),
    );
    await month.selectOption("2026-08");
    await moduleSelect.selectOption("sdm");

    await expect(page.getByText("Tidak ada pembaruan yang cocok", { exact: true })).toBeVisible();
    await expect(titles).toHaveCount(0);
    await page.getByRole("button", { name: "Hapus filter" }).click();
    await expect(month).toHaveValue("");
    await expect(moduleSelect).toHaveValue("");
    await expect(page.getByRole("button", { name: "Untuk orang tua" })).toHaveAttribute("aria-pressed", "true");
    await expect(titles).toHaveText(forParents.slice(0, 5).map((release) => release.headline));

    await month.selectOption("2026-08");
    await moduleSelect.selectOption("buku-penghubung");
    const augustJournal = forParents.filter(({ id, items }) =>
      id.startsWith("2026-08-") && items.some(({ audience, module }) =>
        module === "buku-penghubung" && (audience === "orang-tua" || audience === "semua"),
      ),
    );
    expect(augustJournal).toHaveLength(1);
    await expect(titles).toHaveText(augustJournal.map((release) => release.headline));
    await expect(page.getByRole("navigation", { name: "Halaman pembaruan" })).toHaveCount(0);
  });

  test("each portal links to it from its own menu", async ({ page }) => {
    await signInAs(page, "SUPER_ADMIN");
    await page.goto("/admin");
    await expect(page.getByRole("link", { name: "Apa yang Baru" })).toHaveAttribute("href", "/changelog");

    await page.context().clearCookies();
    await signInAs(page, "GUARDIAN");
    await page.goto("/parent/profile");
    const card = page.getByRole("link", { name: /Apa yang Baru/ });
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: "Apa yang Baru" })).toBeVisible();
  });
});
