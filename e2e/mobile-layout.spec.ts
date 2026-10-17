import { test, expect, type Page } from "@playwright/test";

/**
 * Phone-layout guard (cycle 2026-10-17-mobile-ui-consistency).
 *
 * Walks the admin, teacher and parent routes at 390×844 with a touch pointer
 * and fails on the four ways a screen breaks in a hand:
 *   1. the page scrolls sideways;
 *   2. a control is shorter than 44px (a link/button/input/select/tab; a control
 *      inside a <label> counts through its label; a `::after` hit-area extension
 *      counts, which is how breadcrumb links and checkboxes reach 44px);
 *   3. a data table needs a sideways scroll to show its identity/status/actions
 *      (wide matrices opt out below);
 *   4. a text field is under 16px, which makes iOS zoom the page on focus.
 *
 * Vitest can't see any of this: jsdom has no layout and no `(pointer: coarse)`.
 */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

type Role = "admin" | "teacher" | "parent";

const USER: Record<Role, string> = {
  admin: "u_super_admin",
  teacher: "u_teacher",
  parent: "u_rightjet",
};

// A route ending in `:/list` opens `/list` and follows its first detail link.
const ROUTES: Record<Role, string[]> = {
  admin: [
    "/admin",
    "/admin/work-queue",
    "/admin/students",
    "/admin/students/:/admin/students",
    "/admin/guardians",
    "/admin/guardians/:/admin/guardians",
    "/admin/classes",
    "/admin/classes/:/admin/classes",
    "/admin/admissions",
    "/admin/invoices",
    "/admin/invoices/:/admin/invoices",
    "/admin/payments",
    "/admin/fees",
    "/admin/academic-years",
    "/admin/semesters",
    "/admin/assessments",
    "/admin/report-cards",
    "/admin/student-attendance",
    "/admin/student-journal",
    "/admin/student-journal/monitoring",
    "/admin/employees",
    "/admin/employees/:/admin/employees",
    "/admin/employee-attendance",
    "/admin/employee-attendance/monthly",
    "/admin/leave-requests",
    "/admin/payroll",
    "/admin/payroll/:/admin/payroll",
    "/admin/salary-components",
    "/admin/settings",
    "/admin/settings/campuses",
    "/admin/settings/holidays",
    "/admin/settings/pendaftaran",
    "/admin/settings/roles",
    "/admin/settings/users",
    "/admin/settings/work-hours",
  ],
  teacher: [
    "/teacher",
    "/teacher/attendance",
    "/teacher/class-attendance",
    "/teacher/assessments",
    "/teacher/assessments/weekly",
    "/teacher/student-journal/entry",
    "/teacher/slips",
    "/teacher/slips/:/teacher/slips",
    "/teacher/profile",
  ],
  parent: [
    "/parent",
    "/parent/attendance",
    "/parent/invoices",
    "/parent/perkembangan",
    "/parent/reports",
    "/parent/student-journal",
    "/parent/profile",
  ],
};

// Grids that are wide on purpose (the month × employee matrix): a table that
// scrolls sideways is the right answer there. Everything else must fit.
const WIDE_BY_DESIGN = [/^\/admin\/employee-attendance\/monthly$/];

async function resolve(page: Page, route: string): Promise<string | null> {
  if (!route.includes(":/")) return route;
  const list = route.split(":")[1];
  await page.goto(list);
  await page.locator("h1").first().waitFor();
  // The rows arrive after the shell; wait for the first link into a detail page.
  const detail = page.locator(`a[href^="${list}/"]:not([href*="?"]):not([href$="/new"])`).first();
  if (!(await detail.waitFor({ timeout: 10_000 }).then(() => true, () => false))) return null;
  return page.evaluate((prefix) => {
    const depth = prefix.split("/").length + 1;
    const href = [...document.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => h.startsWith(`${prefix}/`) && h.split("/").length === depth && !h.includes("?") && !h.endsWith("/new"));
    return href ?? null;
  }, list);
}

async function findProblems(page: Page, allowWideTables: boolean): Promise<string[]> {
  return page.evaluate((allowWide) => {
    const problems: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none";
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`;

    const de = document.documentElement;
    if (de.scrollWidth - de.clientWidth > 1) problems.push(`page scrolls sideways by ${de.scrollWidth - de.clientWidth}px`);

    const targets = document.querySelectorAll(
      "a[href],button,[role=button],[role=tab],[role=switch],[role=checkbox],[role=combobox],select,textarea," +
        "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
    );
    for (const el of targets) {
      if (!visible(el)) continue;
      if (el.closest("label")) continue; // the whole label is the tap target
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue; // a link inside running text
      const r = el.getBoundingClientRect();
      const after = getComputedStyle(el, "::after");
      const grown = after.position === "absolute";
      const h = Math.max(r.height, grown ? parseFloat(after.height) || 0 : 0);
      const w = Math.max(r.width, grown ? parseFloat(after.width) || 0 : 0);
      const hasText = (el.textContent ?? "").trim().length > 0;
      if (h < 43.5 || (!hasText && w < 43.5)) problems.push(`tap target ${Math.round(w)}×${Math.round(h)}: ${name(el)}`);
    }

    for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select")) {
      if (visible(el) && parseFloat(getComputedStyle(el).fontSize) < 16) problems.push(`field under 16px (iOS zoom): ${name(el)}`);
    }

    if (!allowWide) {
      for (const box of document.querySelectorAll("[data-slot=table-container]")) {
        if (visible(box) && box.scrollWidth - box.clientWidth > 4) {
          const header = (box.querySelector("th")?.textContent ?? "").trim();
          problems.push(`table scrolls sideways (${box.scrollWidth}>${box.clientWidth}) near "${header}"`);
        }
      }
    }
    return problems;
  }, allowWideTables);
}

for (const role of Object.keys(ROUTES) as Role[]) {
  test.describe(`${role} on a phone`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addCookies([
        { name: "school-erp-session", value: USER[role], domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      ]);
    });

    for (const route of ROUTES[role]) {
      test(route.replace(/\/?:.*$/, "/[id]"), async ({ page }) => {
        const url = await resolve(page, route);
        expect(url, `no detail row to open from ${route.split(":")[1]}`).not.toBeNull();
        await page.goto(url!);
        await page.locator("h1").first().waitFor();
        // Let skeletons resolve into the real rows before measuring.
        await page.waitForLoadState("load");
        await page.waitForTimeout(700);
        const wide = WIDE_BY_DESIGN.some((re) => re.test(new URL(page.url()).pathname));
        expect(await findProblems(page, wide)).toEqual([]);
      });
    }
  });
}
