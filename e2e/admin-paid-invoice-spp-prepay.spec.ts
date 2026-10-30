import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// Money the school already took (cycles 2026-10-27-paid-invoice-spp-prepay and
// 2026-10-30-prepay-other-fees). "Catat pembayaran di muka" is the one place to record it:
//  1. Tagihan Manual always bills the wali: no "Sudah dibayar", and the API refuses a `payment` object;
//  2. one-time fees only ("Tanpa SPP"): one invoice, Lunas when created, one Tunai payment, no payment link;
//  3. SPP months and a one-time fee together: all of them Lunas in one step, and the months then read
//     "Sudah lunas".
// Runs against the production build and the isolated seeded database, signed in as the seeded
// super admin (the same identity the other admin specs use).

type Invoice = {
  id: string;
  status: string;
  periodLabel: string;
  totalDue: string | number;
  totalPaid: string | number;
  xenditPaymentUrl: string | null;
};

type Student = { id: string; name: string; nis: string | null };

type OneTimeComponent = { id: string; label: string; prefillAmount: number | null };

type PreviewJson = {
  blocked: boolean;
  rows: { action: string; periodLabel: string }[];
  spp: { available: boolean; reason: { code: string } | null; defaultRange: { from: string; to: string } | null };
  oneTimeComponents: OneTimeComponent[];
};

/** Same technique as e2e/admin-manual-invoice-layout.spec.ts: keep DatePicker on its native <input type="date">. */
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

async function signInAsAdmin(page: Page) {
  const usersResponse = await page.request.get("/api/auth/users");
  expect(usersResponse.ok()).toBeTruthy();
  const users = (await usersResponse.json()) as { id: string; role: string }[];
  const admin = users.find((user) => user.role === "SUPER_ADMIN");
  expect(admin, "CI seed must provide a real super-admin identity").toBeDefined();
  await page.context().addCookies([
    { name: "school-erp-session", value: admin!.id, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

/**
 * Pick the student in an open StudentPicker by NIS: the seed holds students with identical names, and
 * the first name match may be a twin whose invoices this spec does not look at.
 */
async function pickStudent(page: Page, student: { name: string; nis: string | null }) {
  const options = page.getByRole("option").filter({ hasText: student.name });
  const option = student.nis ? options.filter({ hasText: `NIS ${student.nis}` }) : options;
  await option.first().click();
}

async function listInvoices(page: Page, studentId: string): Promise<Invoice[]> {
  const response = await page.request.get(`/api/invoices?studentId=${studentId}&pageSize=100`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as Invoice[];
}

async function listActiveStudents(request: APIRequestContext): Promise<Student[]> {
  const response = await request.get("/api/students?status=ACTIVE&pageSize=50");
  expect(response.ok()).toBeTruthy();
  const students = (await response.json()).data as Student[];
  expect(students.length, "CI seed must provide active students").toBeGreaterThan(0);
  return students;
}

/** The no-parts preview: whether SPP can be chosen for the student, and the one-time components (with prefill). */
async function previewStudent(request: APIRequestContext, studentId: string, extra: object = {}): Promise<PreviewJson | null> {
  const response = await request.post("/api/invoices/spp-prepay/preview", { data: { studentId, ...extra } });
  return response.ok() ? ((await response.json()) as PreviewJson) : null;
}

function pickComponent(components: OneTimeComponent[], preferred: RegExp): OneTimeComponent {
  const found = components.find((c) => preferred.test(c.label)) ?? components[0];
  expect(found, "the seed must provide an enabled one-time fee component").toBeDefined();
  return found;
}

/** YYYY-MM-DD in Asia/Jakarta, `daysAgo` days back (the dialog refuses a date after today there). */
function jakartaDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

async function openPrepayDialog(page: Page) {
  await page.goto("/admin/invoices");
  await page.getByRole("button", { name: "Catat pembayaran di muka", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Catat Pembayaran di Muka/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseStudent(page: Page, dialog: Locator, student: Student) {
  await dialog.getByRole("combobox").first().click();
  await page.getByPlaceholder("Cari nama siswa...").fill(student.name);
  await pickStudent(page, student);
}

/** Add a one-time line: component by label, then (optionally) type the amount over whatever was prefilled. */
async function addOneTimeLine(page: Page, dialog: Locator, index: number, component: OneTimeComponent, amount?: number) {
  await dialog.getByRole("button", { name: "Tambah biaya", exact: true }).click();
  await dialog.locator(`#spp-prepay-component-${index}`).click();
  await page.getByRole("option", { name: component.label, exact: true }).click();
  const amountInput = dialog.locator(`#spp-prepay-amount-${index}`);
  if (amount !== undefined) await amountInput.fill(String(amount));
  return amountInput;
}

const digits = (value: string) => value.replace(/\D/g, "");

test.describe("Admin — money already taken", () => {
  test.beforeEach(async ({ page }) => {
    await forceCoarsePointer(page);
    await signInAsAdmin(page);
  });

  test("Tagihan Manual always bills the wali: no Sudah dibayar, and the API refuses a payment object", async ({ page }) => {
    const [student] = await listActiveStudents(page.request);
    const before = await listInvoices(page, student.id);

    await page.goto("/admin/invoices");
    await page.getByRole("button", { name: "Tagihan Manual", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Tagihan Manual", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Buat Tagihan", exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByText(/Sudah dibayar/)).toHaveCount(0);

    // A stale client that still sends the retired paid mode gets a 400 and nothing is written.
    const componentsResponse = await page.request.get("/api/fee-components");
    expect(componentsResponse.ok()).toBeTruthy();
    const components = (await componentsResponse.json()) as { id: string; isEnabled: boolean }[];
    const component = components.find((c) => c.isEnabled);
    expect(component, "the seed must provide an enabled fee component").toBeDefined();
    const refused = await page.request.post("/api/invoices", {
      data: {
        studentId: student.id,
        periodLabel: `E2E Biaya Sekolah Tahap 1 ${Date.now()}`,
        dueDate: "2027-07-31",
        lines: [{ feeComponentId: component!.id, amount: 1500000 }],
        payment: { idempotencyKey: crypto.randomUUID(), method: "CASH", paidAt: jakartaDate(0) },
      },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain("Catat pembayaran di muka");
    expect((await listInvoices(page, student.id)).length).toBe(before.length);
  });

  test("Catat pembayaran di muka records one-time fees only, as one Lunas invoice with no payment link", async ({ page }) => {
    // Prefer a student with no class this year ("belum punya kelas": a new intake, the "tahap 1" payer). The seed
    // places most students in a class, but its unplaced applicants have none, unless another spec enrolled
    // them first. Then fall back to an enrolled student with "Tanpa SPP" chosen explicitly.
    let target: { student: Student; preview: PreviewJson; noProgram: boolean } | null = null;
    for (const candidate of await listActiveStudents(page.request)) {
      const preview = await previewStudent(page.request, candidate.id);
      if (!preview || preview.oneTimeComponents.length === 0) continue;
      const noProgram = preview.spp.reason?.code === "NO_PROGRAM";
      if (noProgram) {
        target = { student: candidate, preview, noProgram };
        break;
      }
      target ??= { student: candidate, preview, noProgram };
    }
    expect(target, "CI seed must provide an active student and an enabled one-time fee component").not.toBeNull();
    const { student, preview, noProgram } = target!;
    test.info().annotations.push({
      type: "student",
      description: noProgram ? `no-class student ${student.nis}` : `fallback: enrolled student ${student.nis}, Tanpa SPP chosen`,
    });
    const component = pickComponent(preview.oneTimeComponents, /daftar ulang/i);
    const before = await listInvoices(page, student.id);
    const label = `E2E Biaya Sekolah Tahap 1 TA 2027/2028 ${Date.now() % 1_000_000}`;
    const paidAt = jakartaDate(3);

    const dialog = await openPrepayDialog(page);
    await chooseStudent(page, dialog, student);

    const sppRadio = dialog.getByRole("radio", { name: "Catat SPP beberapa bulan" });
    const noSppRadio = dialog.getByRole("radio", { name: "Tanpa SPP" });
    await expect(noSppRadio).toBeEnabled();
    if (noProgram) {
      await expect(sppRadio).toBeDisabled();
      await expect(noSppRadio).toBeChecked();
      await expect(dialog.getByText(/belum punya kelas/i)).toBeVisible();
    } else {
      await noSppRadio.click();
    }
    await expect(noSppRadio).toBeChecked();
    await expect(dialog.getByText(/Pilih bulan SPP atau tambahkan biaya lainnya/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Catat lunas", exact: true })).toBeDisabled();

    await addOneTimeLine(page, dialog, 0, component, 2500000);

    // A Periode that names a single month is refused on the field (it would hide that month's SPP in the Billing Run).
    const periode = dialog.getByLabel(/^Periode/);
    await periode.fill("Januari 2027");
    await periode.press("Tab");
    await expect(dialog.getByText(/bukan nama bulan/)).toBeVisible();

    await periode.fill(label);
    await dialog.getByLabel(/^Tanggal bayar/).fill(paidAt);
    await expect(dialog.locator("#spp-prepay-method")).toContainText("Tunai");

    // One preview row for the new invoice, with its label and total.
    const table = dialog.getByRole("table");
    await expect(table).toContainText(label);
    await expect(table).toContainText("Buat & lunasi");
    await expect(table).toContainText(/Rp\s?2\.500\.000/);

    const confirm = dialog.getByRole("button", { name: /^Catat Rp .* lunas$/ });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();

    const after = await listInvoices(page, student.id);
    const created = after.filter((invoice) => !before.some((old) => old.id === invoice.id));
    expect(created.length, "exactly one new invoice, for the one-time fees").toBe(1);
    expect(created[0].periodLabel).toBe(label);
    expect(created[0].status).toBe("PAID");
    expect(Number(created[0].totalPaid)).toBe(2500000);
    expect(created[0].xenditPaymentUrl, "a prepaid invoice must not get a payment link").toBeNull();

    const detail = await page.request.get(`/api/invoices/${created[0].id}`);
    expect(detail.ok()).toBeTruthy();
    const body = (await detail.json()) as { payments?: { method: string; amount: string | number; paidAt: string }[] };
    expect(body.payments?.length).toBe(1);
    expect(body.payments?.[0].method).toBe("CASH");
    expect(Number(body.payments?.[0].amount)).toBe(2500000);
    expect(new Date(body.payments![0].paidAt).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })).toBe(paidAt);
  });

  test("Catat pembayaran di muka records SPP months and a one-time fee together", async ({ page }) => {
    // An enrolled student whose last two school-year months are still open, and whose program prices a
    // one-time fee. Other specs share this database, so look at the live preview instead of assuming a
    // student, and take the END of the year (the Billing Run specs work on the current month).
    let target: { student: Student; from: string; to: string; component: OneTimeComponent; rows: PreviewJson["rows"] } | null = null;
    for (const candidate of await listActiveStudents(page.request)) {
      const base = await previewStudent(page.request, candidate.id);
      const range = base?.spp.available ? base.spp.defaultRange : null;
      if (!base || !range) continue;
      const priced = base.oneTimeComponents.filter((c) => (c.prefillAmount ?? 0) > 0);
      if (priced.length === 0) continue;
      const [ty, tm] = range.to.split("-").map(Number);
      const prev = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, "0")}`;
      const narrow = await previewStudent(page.request, candidate.id, { from: prev, to: range.to });
      if (!narrow || narrow.blocked || narrow.rows.length !== 2) continue;
      if (!narrow.rows.every((row) => row.action === "CREATE" || row.action === "SETTLE")) continue;
      target = { student: candidate, from: prev, to: range.to, component: pickComponent(priced, /seragam/i), rows: narrow.rows };
      break;
    }
    expect(target, "CI seed must provide an enrolled student with two open SPP months and a priced one-time fee").not.toBeNull();
    const { student, component, rows } = target!;
    const before = await listInvoices(page, student.id);
    const label = `E2E Seragam TA 2027/2028 ${Date.now() % 1_000_000}`;

    const dialog = await openPrepayDialog(page);
    await chooseStudent(page, dialog, student);

    // The academic-year range is filled in; narrow it to the last two months.
    // Wait for the default-range preview to land: the radio reads checked (and the selects exist)
    // before the student's first look has filled the months in.
    await expect(dialog.getByRole("radio", { name: "Catat SPP beberapa bulan" })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Catat SPP beberapa bulan" })).toBeEnabled();
    await expect(dialog.getByRole("table")).toContainText(rows[rows.length - 1].periodLabel);
    await dialog.locator("#spp-prepay-from").click();
    await page.getByRole("listbox").getByRole("option", { name: rows[0].periodLabel, exact: true }).click();
    await expect(dialog.locator("#spp-prepay-from")).toContainText(rows[0].periodLabel);

    // The one-time amount follows the program's fee table (an ordinary, editable value).
    const amountInput = await addOneTimeLine(page, dialog, 0, component);
    await expect.poll(async () => digits(await amountInput.inputValue())).toBe(String(component.prefillAmount));
    await dialog.getByLabel(/^Periode/).fill(label);

    // The preview lists the two months and one row for the new invoice.
    const table = dialog.getByRole("table");
    await expect(table).toContainText(label);
    for (const row of rows) await expect(table).toContainText(row.periodLabel);
    await expect(table.getByText(/Buat & lunasi|Lunasi tagihan yang ada/)).toHaveCount(3);

    const confirm = dialog.getByRole("button", { name: /^Catat Rp .* lunas$/ });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();

    const after = await listInvoices(page, student.id);
    for (const row of rows) {
      const month = after.filter((invoice) => invoice.periodLabel === row.periodLabel);
      expect(month.some((invoice) => invoice.status === "PAID"), `${row.periodLabel} must be Lunas`).toBe(true);
    }
    const oneTime = after.filter((invoice) => invoice.periodLabel === label);
    expect(oneTime.length).toBe(1);
    expect(oneTime[0].status).toBe("PAID");
    expect(Number(oneTime[0].totalPaid)).toBe(component.prefillAmount);
    for (const invoice of after.filter((inv) => !before.some((old) => old.id === inv.id))) {
      expect(invoice.status).toBe("PAID");
      expect(invoice.xenditPaymentUrl, "prepaid invoices must not get a payment link").toBeNull();
    }

    // Asking again for those months finds them already Lunas.
    const again = await previewStudent(page.request, student.id, { from: target!.from, to: target!.to });
    expect(again).not.toBeNull();
    expect(again!.rows.length).toBe(2);
    expect(again!.rows.every((row) => row.action === "SKIP_PAID")).toBe(true);
  });
});
