import { expect, test, type Locator, type Page } from "@playwright/test";

// Layout regression against the real production-built form and Base UI controls.
// Only the fee catalogue label is replaced to make its long-text case stable;
// authentication and student search use the isolated seeded database. Never submit
// an invoice here: the existing admin.spec.ts covers invoice creation.
const LONG_FEE_LABEL =
  "Biaya kegiatan pembelajaran tambahan dan perlengkapan sekolah semester ganjil";
const PERIOD = "E2E formulir panjang";

/**
 * T8 date/money sweep: "Tanggal Jatuh Tempo" now uses the shared DatePicker,
 * which renders a Calendar popover on a fine pointer (desktop Chromium's
 * default). This spec's `.fill("2026-12-31")` / `.toHaveValue("2026-12-31")`
 * calls target the native `<input type="date">`, so force `(pointer:
 * coarse)` — same technique as e2e/curriculum-admin.spec.ts — to keep
 * DatePicker on that branch instead of driving a Calendar popover.
 */
async function forceCoarsePointer(page: Page) {
  await page.addInitScript(() => {
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query === "(pointer: coarse)") {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList;
      }
      return realMatchMedia(query);
    };
  });
}

/**
 * T8 date/money sweep: the per-line amount fields are now RupiahInput, a
 * text input with id-ID thousands grouping while typing — not
 * `<input type="number">` (role=spinbutton) any more. Each has a real
 * `<FieldLabel htmlFor>` reading "Jumlah N" (N = 1-indexed row position),
 * so locate by that instead.
 */
function amountInputs(dialog: Locator) {
  return dialog.getByLabel(/^Jumlah \d+/);
}

/** The control that opens Tagihan Manual at the current width: the inline button, or "Lainnya" below `sm`. */
function manualInvoiceOpener(page: Page) {
  return page
    .getByRole("button", { name: "Tagihan Manual", exact: true })
    .or(page.getByRole("button", { name: "Lainnya", exact: true }))
    .filter({ visible: true })
    .first();
}

async function openLongInvoiceForm(page: Page) {
  await forceCoarsePointer(page);
  const usersResponse = await page.request.get("/api/auth/users");
  expect(usersResponse.ok()).toBeTruthy();
  const users = (await usersResponse.json()) as { id: string; role: string }[];
  const admin = users.find((user) => user.role === "SUPER_ADMIN");
  expect(admin, "CI seed must provide a real super-admin identity").toBeDefined();
  await page.context().addCookies([{
    name: "school-erp-session", value: admin!.id, domain: "localhost", path: "/",
    httpOnly: true, sameSite: "Lax",
  }]);

  const studentsResponse = await page.request.get("/api/students?status=ACTIVE&pageSize=1");
  expect(studentsResponse.ok()).toBeTruthy();
  const student = (await studentsResponse.json()).data[0] as { id: string; name: string };
  expect(student, "CI seed must provide an active student").toBeDefined();

  await page.route("**/api/fee-components", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    const fees = (await response.json()) as {
      id: string; label: string; isEnabled: boolean; status: string;
    }[];
    const active = fees.find((fee) => fee.isEnabled && fee.status === "ACTIVE");
    expect(active, "CI seed must provide an active fee component").toBeDefined();
    await route.fulfill({ response, json: [{ ...active!, label: LONG_FEE_LABEL }] });
  });

  await page.goto("/admin/invoices");
  await manualInvoiceOpener(page).click();
  // Below `sm` the secondary header actions sit in the "Lainnya" menu.
  const menuItem = page.getByRole("menuitem", { name: "Tagihan Manual", exact: true });
  if (await menuItem.isVisible().catch(() => false)) await menuItem.click();
  const dialog = page.getByRole("dialog", { name: "Tagihan Manual", exact: true });
  await expect(dialog).toBeVisible();
  const studentPicker = dialog.getByRole("combobox").first();
  await studentPicker.click();
  await page.getByPlaceholder("Cari nama siswa...").fill(student.name);
  await page.getByRole("option").filter({ hasText: student.name }).first().click();
  await expect(studentPicker).toContainText(student.name);
  await dialog.getByLabel(/^Periode/).fill(PERIOD);
  await dialog.getByLabel(/^Tanggal Jatuh Tempo/).fill("2026-12-31");
  const feeTrigger = dialog.getByRole("combobox").nth(1);
  await expect(feeTrigger).toContainText(LONG_FEE_LABEL);
  await feeTrigger.click();
  const feeOption = page.getByRole("option", { name: LONG_FEE_LABEL, exact: true });
  await expect(feeOption).toBeVisible();
  const optionGeometry = await feeOption.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      left: bounds.left, right: bounds.right, viewport: innerWidth,
      clippedText: [...range.getClientRects()].some((rect) =>
        rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ||
        rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1),
    };
  });
  expect(optionGeometry.clippedText, "fee options must expose the entire long label").toBe(false);
  expect(optionGeometry.left).toBeGreaterThanOrEqual(-1);
  expect(optionGeometry.right).toBeLessThanOrEqual(optionGeometry.viewport + 1);
  await page.keyboard.press("Escape");
  await expect(feeOption).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(feeTrigger).toBeFocused();
  for (let index = 1; index < 8; index++) {
    await dialog.getByRole("button", { name: "Tambah Komponen", exact: true }).click();
  }
  await expect(amountInputs(dialog)).toHaveCount(8);
  await amountInputs(dialog).first().fill("125000");
  return { dialog, studentName: student.name };
}

async function expectContainedControls(dialog: Locator) {
  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const escaped = [...element.querySelectorAll<HTMLElement>("input, button, [role=combobox]")]
      .filter((control) => control.getClientRects().length > 0)
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
      }).map((control) => control.getAttribute("aria-label") || control.textContent || control.tagName);
    return {
      top: bounds.top, bottom: bounds.bottom, viewport: innerHeight,
      horizontalOverflow: element.scrollWidth - element.clientWidth, escaped,
    };
  });
  expect(geometry.escaped, "form controls must stay inside the overlay").toEqual([]);
  expect(geometry.horizontalOverflow, "long fee labels must not widen the form").toBeLessThanOrEqual(1);
  expect(geometry.top).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function wheelThroughForm(page: Page, dialog: Locator) {
  const scrollHandle = await amountInputs(dialog).last().evaluateHandle((input) => {
    for (let parent = input.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        return parent;
      }
    }
    return null;
  });
  const scrollElement = scrollHandle.asElement();
  expect(scrollElement, "eight rows must have a real scrollable form body").not.toBeNull();
  const box = await scrollElement!.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 4, box!.y + Math.min(box!.height / 2, 100));
  await page.mouse.wheel(0, -4000);
  await expect.poll(() => scrollElement!.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole("button", { name: "Buat Tagihan", exact: true })).toBeInViewport({ ratio: 0.95 });
  await page.mouse.wheel(0, 4000);
  await expect.poll(() => scrollElement!.evaluate((element) => element.scrollTop)).toBeGreaterThan(30);
  await expect(amountInputs(dialog).last()).toBeInViewport({ ratio: 0.95 });
  await expect(dialog.getByText("Total", { exact: true })).toBeInViewport({ ratio: 0.95 });
  await expect(dialog.getByRole("button", { name: "Buat Tagihan", exact: true })).toBeInViewport({ ratio: 0.95 });
  await scrollHandle.dispose();
}

async function tabTo(page: Page, target: Locator, maxTabs: number) {
  for (let index = 0; index < maxTabs; index++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

for (const viewport of [
  { width: 1280, height: 600 },
  { width: 1440, height: 900 },
  { width: 768, height: 640 },
  { width: 390, height: 740 },
  { width: 320, height: 568 },
]) {
  test(`manual invoice keeps eight long-label rows scrollable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { dialog } = await openLongInvoiceForm(page);
    await expectContainedControls(dialog);
    await wheelThroughForm(page, dialog);

    await dialog.getByLabel(/^Periode/).focus();
    const lastAmount = amountInputs(dialog).last();
    await tabTo(page, lastAmount, 40);
    await page.keyboard.type("87500");
    // RupiahInput groups thousands as the admin types — id-ID formatting,
    // not the raw digits a native `<input type="number">` would show.
    await expect(lastAmount).toHaveValue("87.500");
    await expect(lastAmount).toBeInViewport({ ratio: 0.95 });
    const submit = dialog.getByRole("button", { name: "Buat Tagihan", exact: true });
    await tabTo(page, submit, 10);
    await expect(submit).toBeFocused();
    await expect(submit).toBeInViewport({ ratio: 0.95 });
    // Do not press Enter: no invoice/payment mutation is part of this layout test.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Focus returns to whatever opened the form: the inline button, or "Lainnya" on a phone.
    await expect(manualInvoiceOpener(page)).toBeFocused();
  });
}

test("manual invoice preserves entered values when an open form crosses the mobile breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const { dialog, studentName } = await openLongInvoiceForm(page);
  await amountInputs(dialog).last().fill("87500");
  for (const viewport of [{ width: 1280, height: 600 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^Periode/)).toHaveValue(PERIOD);
    await expect(dialog.getByLabel(/^Tanggal Jatuh Tempo/)).toHaveValue("2026-12-31");
    await expect(dialog.getByRole("combobox").first()).toContainText(studentName);
    await expect(amountInputs(dialog)).toHaveCount(8);
    // RupiahInput's id-ID thousands grouping, not raw digits.
    await expect(amountInputs(dialog).first()).toHaveValue("125.000");
    await expect(amountInputs(dialog).last()).toHaveValue("87.500");
    await expectContainedControls(dialog);
    await wheelThroughForm(page, dialog);
  }
});
