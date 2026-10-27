import { expect, test, type Page } from "@playwright/test";

// Money the school already took (cycle 2026-10-27-paid-invoice-spp-prepay):
//  1. a manual invoice created already paid ("Sudah dibayar") is Lunas at once, with one payment and
//     no payment link, so nothing goes to the wali;
//  2. "Catat SPP di muka" previews a student's SPP for the academic year and settles every month
//     in one step, again without a link.
// Runs against the production build and the isolated seeded database, signed in as the seeded
// super admin (the same identity the other admin specs use).

type Invoice = {
  id: string;
  status: string;
  totalDue: string | number;
  totalPaid: string | number;
  xenditPaymentUrl: string | null;
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

async function listInvoices(page: Page, studentId: string): Promise<Invoice[]> {
  const response = await page.request.get(`/api/invoices?studentId=${studentId}&pageSize=100`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as Invoice[];
}

test.describe("Admin — money already taken", () => {
  test.beforeEach(async ({ page }) => {
    await forceCoarsePointer(page);
    await signInAsAdmin(page);
  });

  test("Tagihan Manual → Sudah dibayar creates a Lunas invoice with no payment link", async ({ page }) => {
    const studentsResponse = await page.request.get("/api/students?status=ACTIVE&pageSize=1");
    expect(studentsResponse.ok()).toBeTruthy();
    const student = (await studentsResponse.json()).data[0] as { id: string; name: string };
    expect(student, "CI seed must provide an active student").toBeDefined();
    const before = await listInvoices(page, student.id);

    await page.goto("/admin/invoices");
    await page.getByRole("button", { name: "Tagihan Manual", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Tagihan Manual", exact: true });
    await expect(dialog).toBeVisible();

    const studentPicker = dialog.getByRole("combobox").first();
    await studentPicker.click();
    await page.getByPlaceholder("Cari nama siswa...").fill(student.name);
    await page.getByRole("option").filter({ hasText: student.name }).first().click();
    await expect(studentPicker).toContainText(student.name);

    await dialog.getByLabel(/^Periode/).fill("E2E Biaya Sekolah Tahap 1 TA 2027/2028");
    await dialog.getByLabel(/^Tanggal Jatuh Tempo/).fill("2027-07-31");
    await dialog.getByLabel(/^Jumlah 1/).fill("1500000");

    // Without the option the button is the plain create; ticking it flips to the paid save.
    await expect(dialog.getByRole("button", { name: "Buat Tagihan", exact: true })).toBeVisible();
    await dialog.getByRole("checkbox", { name: /Sudah dibayar/ }).check();
    await expect(dialog.getByText(/tidak ada email ke wali/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Simpan sebagai lunas", exact: true }).click();

    await page.waitForURL(/\/admin\/invoices\/[^/]+$/);
    const invoiceId = page.url().split("/").pop()!;
    const after = await listInvoices(page, student.id);
    expect(after.length).toBe(before.length + 1);
    const created = after.find((invoice) => invoice.id === invoiceId)!;
    expect(created.status).toBe("PAID");
    expect(Number(created.totalPaid)).toBe(1500000);
    expect(created.xenditPaymentUrl, "a paid-at-creation invoice must not get a payment link").toBeNull();

    const detail = await page.request.get(`/api/invoices/${invoiceId}`);
    expect(detail.ok()).toBeTruthy();
    const body = (await detail.json()) as { payments?: { method: string; amount: string | number }[] };
    expect(body.payments?.length).toBe(1);
    expect(body.payments?.[0].method).toBe("CASH");
  });

  test("Catat SPP di muka previews the year and settles every month without a link", async ({ page }) => {
    // Find an active student the preview can price (enrolled this year, fee structure present).
    const studentsResponse = await page.request.get("/api/students?status=ACTIVE&pageSize=50");
    expect(studentsResponse.ok()).toBeTruthy();
    const candidates = (await studentsResponse.json()).data as { id: string; name: string }[];
    let target: { id: string; name: string } | null = null;
    for (const candidate of candidates) {
      const preview = await page.request.post("/api/invoices/spp-prepay/preview", { data: { studentId: candidate.id } });
      if (!preview.ok()) continue;
      const json = (await preview.json()) as { blocked: boolean; rows: { action: string }[] };
      if (!json.blocked && json.rows.some((row) => row.action === "CREATE" || row.action === "SETTLE")) {
        target = candidate;
        break;
      }
    }
    expect(target, "CI seed must provide an enrolled student whose SPP can be priced").not.toBeNull();
    const before = await listInvoices(page, target!.id);
    const paidBefore = before.filter((invoice) => invoice.status === "PAID").length;

    await page.goto("/admin/invoices");
    await page.getByRole("button", { name: "Catat SPP di muka", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Catat SPP di Muka/i });
    await expect(dialog).toBeVisible();

    const studentPicker = dialog.getByRole("combobox").first();
    await studentPicker.click();
    await page.getByPlaceholder("Cari nama siswa...").fill(target!.name);
    await page.getByRole("option").filter({ hasText: target!.name }).first().click();

    // The preview lists the months with what will happen to each.
    const table = dialog.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByText(/Buat & lunasi|Lunasi tagihan yang ada/).first()).toBeVisible();

    const confirm = dialog.getByRole("button", { name: /^Catat Rp .* lunas$/ });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();

    const after = await listInvoices(page, target!.id);
    const paidAfter = after.filter((invoice) => invoice.status === "PAID").length;
    expect(paidAfter).toBeGreaterThan(paidBefore);
    const created = after.filter((invoice) => !before.some((old) => old.id === invoice.id));
    for (const invoice of created) {
      expect(invoice.status).toBe("PAID");
      expect(invoice.xenditPaymentUrl, "prepaid months must not get a payment link").toBeNull();
    }

    // Asking again finds nothing left to record: every month is already Lunas.
    const again = await page.request.post("/api/invoices/spp-prepay/preview", { data: { studentId: target!.id } });
    expect(again.ok()).toBeTruthy();
    const preview = (await again.json()) as { rows: { action: string }[] };
    expect(preview.rows.every((row) => row.action === "SKIP_PAID")).toBe(true);
  });
});
