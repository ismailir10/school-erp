import { test, expect, type Locator, type Page } from "@playwright/test";

// Visual regression anchor for the Design System reference page.
//
// The page iframes /admin/design-system-reference.html (copy of
// .claude/standards/design-system.html). Any drift between the canonical
// HTML and what lands in production is caught by this test, not by eyeball.

const ADMIN_USER_ID = "u_super_admin";

async function demoSession(page: Page, userId: string) {
  await page.context().addCookies([{
    name: "school-erp-session", value: userId, domain: "localhost", path: "/",
    httpOnly: true, sameSite: "Lax",
  }]);
}

/** Measure rendered ink, including alpha and transparent ancestor surfaces. */
async function renderedContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const blend = (foreground: number[], background: number[]) =>
      foreground.slice(0, 3).map((channel, i) => channel * foreground[3] / 255 + background[i] * (1 - foreground[3] / 255));
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) background = blend(rgba(getComputedStyle(node).backgroundColor), background);
    const style = getComputedStyle(element);
    const foreground = blend(rgba(style.color), background);
    const luminance = (rgb: number[]) => rgb.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const light = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return { ratio: (light + 0.05) / (dark + 0.05), foreground: style.color, background: style.backgroundColor, effectiveBackground: background };
  });
}

test.describe("Design System reference page", () => {
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

  test("loads with PageHeader, iframe, and action buttons", async ({
    page,
  }) => {
    await page.goto("/admin/design-system");
    await page.waitForURL("**/admin/design-system", { timeout: 15_000 });

    await expect(page.locator("h1", { hasText: "Design System" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Buka di tab baru/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Sumber di GitHub/i }),
    ).toBeVisible();

    // Check the embedded document itself: a successful direct GET does not
    // prove the browser was allowed to display it in a frame.
    const iframe = page.locator(
      'iframe[title="Talib Design System reference"]',
    );
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute(
      "src",
      "/admin/design-system-reference.html",
    );
    const reference = page.frameLocator('iframe[title="Talib Design System reference"]');
    await expect(reference.locator("#brand")).toBeVisible();
    await expect(reference.locator("#brand h2")).toContainText("Brand");
  });

  test("static reference HTML is served at expected path", async ({
    page,
  }) => {
    const response = await page.goto("/admin/design-system-reference.html");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"] ?? "").toContain("text/html");
    expect(response?.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response?.headers()["content-security-policy-report-only"] ?? "").toContain("frame-ancestors 'self'");

    // Sanity — every canonical section the design system promises should be
    // anchor-linkable in the HTML.
    const content = await page.content();
    for (const anchor of [
      'id="brand"',
      'id="colors"',
      'id="typography"',
      'id="spacing"',
      'id="buttons"',
      'id="forms"',
      'id="overlays"',
      'id="portal"',
      'id="journal"',
      'id="voice"',
    ]) {
      expect(content, `missing ${anchor} in reference HTML`).toContain(anchor);
    }
  });

  test("form controls have visible keyboard focus and overlays honor reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/admin/students");

    const opener = page.getByRole("button", { name: "Tambah Siswa", exact: true });
    await opener.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Tambah Siswa" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("animation-name", "none");

    const name = dialog.getByPlaceholder("Aisyah Putri", { exact: true });
    await name.focus();
    await expect(name).toBeFocused();
    await expect(name).toHaveCSS("border-top-color", "rgb(137, 131, 125)");
    await expect(name).toHaveCSS("outline-style", "solid");
    await expect(name).toHaveCSS("outline-width", "2px");
    await expect(name).toHaveCSS("outline-color", "rgb(23, 53, 54)");
    // Keep the indicator inside the dialog’s clipped scroll viewport.
    await expect(name).toHaveCSS("outline-offset", "-2px");

    await page.emulateMedia({ forcedColors: "active" });
    await expect(name).toHaveCSS("outline-style", "solid");
    await expect(name).toHaveCSS("outline-width", "2px");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("Rendered calm color semantics", () => {
  test("admin attendance Button selection keeps the soft brand treatment", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await demoSession(page, ADMIN_USER_ID);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      let recordedDate: string | undefined;
      for (let offset = 1; offset <= 7 && !recordedDate; offset++) {
        const date = new Date(Date.parse(`${today}T12:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
        const response = await page.request.get(`/api/attendance/daily?date=${date}`);
        expect(response.ok()).toBeTruthy();
        const body = await response.json() as { rows: Array<{ attendance: { status: string; approvalStatus: string } | null }> };
        if (body.rows.some(({ attendance }) => attendance?.approvalStatus === "APPROVED" && ["PRESENT", "SICK", "PERMISSION", "ABSENT"].includes(attendance.status))) recordedDate = date;
      }
      expect(recordedDate, "seed must provide an approved staff attendance day").toBeTruthy();
      // Initial hydration first requests an unspecified date, then adopts the
      // server's today and refetches. Wait for that initialization before editing
      // the filter; otherwise its late response can overwrite our chosen date.
      const initialized = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === "/api/attendance/daily" && url.searchParams.get("date") === today;
      });
      await page.goto("/admin/employee-attendance/daily");
      const dateInput = page.locator('input[type="date"]');
      await expect(dateInput).toBeVisible();
      const initialResponse = await initialized;
      expect(initialResponse.ok()).toBeTruthy();
      await initialResponse.finished();
      await expect(dateInput).toHaveValue(today);
      const filtered = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === "/api/attendance/daily" && url.searchParams.get("date") === recordedDate;
      });
      await dateInput.fill(recordedDate!);
      const filteredResponse = await filtered;
      expect(filteredResponse.ok()).toBeTruthy();
      await filteredResponse.finished();
      await expect(dateInput).toHaveValue(recordedDate!);
      const selected = page.getByRole("button", { pressed: true }).and(page.locator(":enabled")).first();
      await expect(selected).toBeVisible();
      await expect(selected).toHaveCSS("background-color", "rgb(93, 180, 184)");
      await expect(selected).toHaveCSS("color", "rgb(23, 53, 54)");
      expect((await renderedContrast(selected)).ratio).toBeGreaterThanOrEqual(4.5);

      // A future date disables the real bulk action without saving any data.
      // Disabled actions must not fade white text onto a light teal surface.
      const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const futureLoad = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === "/api/attendance/daily" && url.searchParams.get("date") === tomorrow;
      });
      await dateInput.fill(tomorrow);
      const futureResponse = await futureLoad;
      expect(futureResponse.ok()).toBeTruthy();
      await futureResponse.finished();
      await expect(dateInput).toHaveValue(tomorrow);
      const disabledAction = page.getByRole("button", { name: /^Tandai semua hadir/ });
      await expect(disabledAction).toBeDisabled();
      await expect(disabledAction).toHaveCSS("opacity", "1");
      await expect(disabledAction).not.toHaveCSS("color", "rgb(255, 255, 255)");
      expect((await renderedContrast(disabledAction)).ratio).toBeGreaterThanOrEqual(4.5);
    } finally {
      await context.close();
    }
  });

  test("primary actions are readable at rest and hover while child selection stays soft", async ({ page }) => {
    await demoSession(page, ADMIN_USER_ID);
    await page.goto("/admin/students");
    const action = page.getByRole("button", { name: "Tambah Siswa", exact: true });
    await expect(action).toBeVisible();
    await expect(action).toHaveCSS("background-color", "rgb(40, 119, 123)");
    await expect(action).toHaveCSS("color", "rgb(255, 255, 255)");
    expect((await renderedContrast(action)).ratio).toBeGreaterThanOrEqual(4.5);
    await action.hover();
    await expect(action).toHaveCSS("background-color", "rgb(32, 100, 104)");
    expect((await renderedContrast(action)).ratio).toBeGreaterThanOrEqual(4.5);

    await demoSession(page, "u_rightjet");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/parent/attendance");
    const children = page.getByRole("tablist", { name: "Pilih anak" });
    const selected = children.getByRole("tab", { selected: true });
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveCSS("background-color", "rgb(93, 180, 184)");
    await expect(selected).toHaveCSS("color", "rgb(23, 53, 54)");
    expect((await renderedContrast(selected)).ratio).toBeGreaterThanOrEqual(4.5);
    await selected.focus();
    await page.keyboard.press("ArrowRight");
    const nextChild = children.getByRole("tab").nth(1);
    await expect(nextChild).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(nextChild).toHaveAttribute("aria-selected", "true");
    await expect(children.getByRole("tab", { selected: true })).toHaveCount(1);
  });

  test("selected attendance labels are readable with a non-color cue and neutral present row", async ({ page }) => {
    await demoSession(page, "u_teacher");
    await page.setViewportSize({ width: 320, height: 844 });
    const assignmentsResponse = await page.request.get("/api/teaching-assignments/my");
    expect(assignmentsResponse.ok()).toBeTruthy();
    const assignments = await assignmentsResponse.json() as Array<{ classSection: { id: string; status: string; academicYear: { status: string } } }>;
    const assignment = assignments.find(item => item.classSection.status === "ACTIVE" && item.classSection.academicYear.status === "ACTIVE");
    expect(assignment, "seed must provide an active assigned class").toBeTruthy();
    const classId = assignment!.classSection.id;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const labels: Record<string, string> = { PRESENT: "Hadir", SICK: "Sakit", PERMISSION: "Izin", ABSENT: "Alpa" };
    // Reuse an actually recorded seed day within this week's roster, then restore
    // its original value through the UI. No fixed calendar date or DB write.
    let fixture: { date: string; name: string; status: string } | undefined;
    for (let offset = 1; offset <= 7 && !fixture; offset++) {
      const date = new Date(Date.parse(`${today}T12:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
      const response = await page.request.get(`/api/student-attendance?classSectionId=${classId}&date=${date}`);
      expect(response.ok()).toBeTruthy();
      const roster = await response.json() as Array<{ student: { name: string }; attendance: { status: string; notes: string | null; checkInTime: string | null; checkOutTime: string | null } | null }>;
      // Changing to an exception intentionally clears arrival times/notes in the
      // product. Pick a record without those fields so restoring status restores
      // its full meaningful state rather than destroying another flow's fixture.
      const recorded = roster.find(({ attendance }) => attendance && labels[attendance.status]
        && !attendance.notes && !attendance.checkInTime && !attendance.checkOutTime);
      if (recorded) fixture = { date, name: recorded.student.name, status: recorded.attendance!.status };
    }
    expect(fixture, "seed must provide a recorded day without arrival times/notes in the last seven days").toBeTruthy();
    await page.goto(`/teacher/class-attendance?classId=${classId}&date=${fixture!.date}`);
    const group = page.getByRole("radiogroup", { name: `Status ${fixture!.name}`, exact: true });
    await expect(group).toBeVisible();
    const choose = async (label: string) => {
      const radio = group.getByRole("radio", { name: label, exact: true });
      if (await radio.getAttribute("aria-checked") !== "true") {
        const saved = page.waitForResponse(response => response.url().endsWith("/api/student-attendance/mark") && response.request().method() === "POST");
        await radio.click();
        expect((await saved).ok()).toBeTruthy();
      }
      await expect(radio).toHaveAttribute("aria-checked", "true");
      await expect(group).not.toHaveAttribute("aria-busy", "true");
      return radio;
    };
    try {
      for (const label of Object.values(labels)) {
        const radio = await choose(label);
        await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
        // Border width communicates selection even without hue perception.
        await expect(radio).toHaveCSS("border-top-width", "2px");
        await expect(group.getByRole("radio", { checked: false }).first()).toHaveCSS("border-top-width", "1px");
        expect((await renderedContrast(radio)).ratio, `${label} label contrast`).toBeGreaterThanOrEqual(4.5);
        const bounds = await radio.boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        if (label === "Hadir") {
          const row = page.getByTestId("roster-row").filter({ has: group });
          await expect(row).toHaveCSS("background-color", "rgb(255, 255, 255)");
          const { effectiveBackground } = await renderedContrast(row);
          expect(effectiveBackground).toEqual([255, 255, 255]);
        }
      }
    } finally {
      await choose(labels[fixture!.status]);
    }
  });

  test("small parent calendar dates retain readable ink", async ({ page }) => {
    await demoSession(page, "u_rightjet");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/parent/attendance");
    const dates = page.locator("table thead th:not(:first-child) > div:last-child");
    await expect(dates).toHaveCount(5);
    for (const date of await dates.all()) {
      await expect(date).toBeVisible();
      expect((await renderedContrast(date)).ratio, `date ${await date.innerText()} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
