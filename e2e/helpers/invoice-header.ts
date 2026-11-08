import type { Page } from "@playwright/test";

/**
 * The /admin/invoices header keeps only "Buat Tagihan" (and "Catat pembayaran di muka")
 * inline; every other action is a menuitem in the "Aksi lainnya" (⋯) menu.
 */
export async function openInvoiceHeaderMenuItem(page: Page, name: string) {
  await page.getByRole("button", { name: "Aksi lainnya" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
