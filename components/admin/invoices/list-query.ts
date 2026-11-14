import { INVOICE_LIST_STATUS_VALUES } from "@/lib/constants/invoice-status";

/** Same per-tab return-context pattern as the students list. */
export const INVOICE_LIST_QUERY_KEY = "admin.invoices.listQuery";
const SORT_FIELDS = ["createdAt", "invoiceNumber", "dueDate", "totalDue", "totalPaid", "status", "periodLabel", "paymentLinkExpiresAt"];
export function parseInvoiceListQuery(query: string, fallbackStatus = "all") {
  const params = new URLSearchParams(query);
  const rawStatus = params.get("status") ?? fallbackStatus;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  const rawSort = params.get("sortBy") ?? "createdAt";
  return {
    search: params.get("q") ?? "",
    status: (INVOICE_LIST_STATUS_VALUES as readonly string[]).includes(rawStatus) ? rawStatus : "all",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize : 20,
    sortBy: SORT_FIELDS.includes(rawSort) ? rawSort : "createdAt",
    sortOrder: params.get("sortOrder") === "asc" ? "asc" as const : "desc" as const,
  };
}
