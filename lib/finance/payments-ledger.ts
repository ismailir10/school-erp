import { prisma } from "@/lib/db";
import { cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paymentMethodLabel, PAYMENT_METHODS } from "@/lib/constants/payment-methods";

/**
 * Payments-received ledger (penerimaan). A date-range list of Payment rows
 * with a per-method summary, for the admin treasurer recap. Read-only.
 *
 * Date semantics: `paidAt` (when the money arrived) is the economic date, not
 * `createdAt`. `REVERSED` payments are excluded — they represent undone
 * receipts; `RECORDED` + `APPROVED` both count as money in. Tenant scope is
 * enforced through the invoice relation (Payment has no tenantId column).
 *
 * The range is given as YYYY-MM-DD Jakarta calendar days. `paidAt` is a real
 * timestamptz, so the window is [start-of-dateFrom, start-of-(dateTo+1)) in
 * Jakarta time → converted to the UTC instants Prisma compares against.
 */

export type LedgerRow = {
  id: string;
  invoiceId: string;
  paidAt: string; // ISO timestamp
  amount: number;
  method: string;
  methodLabel: string;
  reference: string | null;
  invoiceNumber: string;
  studentName: string;
};

export type LedgerSummary = {
  totalAmount: number;
  totalCount: number;
  byMethod: Array<{ method: string; methodLabel: string; amount: number; count: number }>;
};

export type LedgerPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type LedgerSortKey = "paidAt" | "amount" | "method" | "reference";

type LedgerQueryOptions = {
  search?: string;
  skip?: number;
  take?: number;
  sortBy?: LedgerSortKey;
  sortOrder?: "asc" | "desc";
};

/**
 * Validate a YYYY-MM-DD string. Digit-and-shape check, then a real-date round
 * trip so 2026-02-31 / 2026-13-01 are rejected — bad input must 400, never a
 * misleading-but-200 empty ledger.
 */
export function isValidYmd(value: string): boolean {
  const m = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return false;
  const [y, mo, d] = m.split("-").map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
  // Reject impossible days (Feb 30, etc.) via UTC round-trip.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Parse + validate the dateFrom/dateTo pair. Returns null on any invalid or
 * inverted range. Both default to `today` (caller supplies the Jakarta today)
 * when blank — a single-day "today's cash" view.
 */
export function parseDateRange(
  fromRaw: string,
  toRaw: string,
  today: string,
): { dateFrom: string; dateTo: string } | null {
  const dateFrom = (fromRaw || today).trim();
  const dateTo = (toRaw || today).trim();
  if (!isValidYmd(dateFrom) || !isValidYmd(dateTo)) return null;
  if (dateFrom > dateTo) return null; // lexicographic = chronological for YMD
  return { dateFrom, dateTo };
}

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // WIB = UTC+7, no DST

/**
 * UTC instant for start-of-day of a Jakarta calendar date. `2026-06-13` in
 * WIB is `2026-06-12T17:00:00Z`.
 */
function jakartaDayStartUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - JAKARTA_OFFSET_MS);
}

function parsePositiveInt(raw: string | null, fallback: number, max?: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return max ? Math.min(parsed, max) : parsed;
}

/**
 * Shared request resolver for the ledger + export routes: validates the date
 * range and method, then runs the query. Keeps the two endpoints from
 * drifting apart (mirrors resolveRecapRequest in student-recap).
 */
export async function resolveLedgerRequest(
  tenantId: string,
  searchParams: URLSearchParams,
  today: string,
  options: { paginate?: boolean } = {},
): Promise<
  | {
      ok: true;
      rows: LedgerRow[];
      summary: LedgerSummary;
      dateFrom: string;
      dateTo: string;
      pagination?: LedgerPagination;
    }
  | { ok: false; error: string }
> {
  const range = parseDateRange(
    searchParams.get("dateFrom") ?? "",
    searchParams.get("dateTo") ?? "",
    today,
  );
  if (!range) return { ok: false, error: "Rentang tanggal tidak valid" };

  const method = searchParams.get("method") || undefined;
  if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: "Metode pembayaran tidak valid" };
  }

  // NUL / control characters 500 in Postgres; % and _ are LIKE wildcards.
  const search = escapeLike(cleanSearch(searchParams.get("search")));
  const sortByRaw = searchParams.get("sortBy") ?? "paidAt";
  if (!["paidAt", "amount", "method", "reference"].includes(sortByRaw)) {
    return { ok: false, error: "Kolom urut tidak valid" };
  }
  const sortOrderRaw = searchParams.get("sortOrder") ?? "desc";
  if (sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
    return { ok: false, error: "Arah urut tidak valid" };
  }

  let page = 1;
  let pageSize = 20;
  let skip: number | undefined;
  let take: number | undefined;
  if (options.paginate) {
    const parsedPage = parsePositiveInt(searchParams.get("page"), 1);
    const parsedPageSize = parsePositiveInt(searchParams.get("pageSize"), 20, 100);
    if (parsedPage === null || parsedPageSize === null) {
      return { ok: false, error: "Pagination tidak valid" };
    }
    page = parsedPage;
    pageSize = parsedPageSize;
    const skipCandidate = (page - 1) * pageSize;
    if (!Number.isSafeInteger(skipCandidate)) {
      return { ok: false, error: "Pagination tidak valid" };
    }
    skip = skipCandidate;
    take = pageSize;
  }

  const { rows, summary } = await getPaymentsLedger(
    tenantId,
    range.dateFrom,
    range.dateTo,
    method,
    {
      search,
      skip,
      take,
      sortBy: sortByRaw as LedgerSortKey,
      sortOrder: sortOrderRaw,
    },
  );
  return {
    ok: true,
    rows,
    summary,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    ...(options.paginate
      ? {
          pagination: {
            page,
            pageSize,
            total: summary.totalCount,
            totalPages: Math.max(1, Math.ceil(summary.totalCount / pageSize)),
          },
        }
      : {}),
  };
}

export async function getPaymentsLedger(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  method?: string,
  options: LedgerQueryOptions = {},
): Promise<{ rows: LedgerRow[]; summary: LedgerSummary }> {
  const gte = jakartaDayStartUtc(dateFrom);
  // Exclusive upper bound = start of the day after dateTo.
  const ltDate = new Date(jakartaDayStartUtc(dateTo).getTime() + 24 * 60 * 60 * 1000);
  const search = options.search?.trim();
  const where = {
    status: { not: "REVERSED" },
    paidAt: { gte, lt: ltDate },
    ...(method ? { method } : {}),
    invoice: { tenantId },
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" as const } },
            { invoice: { invoiceNumber: { contains: search, mode: "insensitive" as const } } },
            { invoice: { student: { name: { contains: search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  const [payments, methodSummary] = await Promise.all([
    prisma.payment.findMany({
      where,
      ...(options.skip !== undefined ? { skip: options.skip } : {}),
      ...(options.take !== undefined ? { take: options.take } : {}),
      select: {
        id: true,
        paidAt: true,
        amount: true,
        method: true,
        channelCode: true,
        reference: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            student: { select: { name: true } },
          },
        },
      },
      orderBy: [
        { [options.sortBy ?? "paidAt"]: options.sortOrder ?? "desc" },
        { id: "asc" },
      ],
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const rows: LedgerRow[] = payments.map((p) => ({
    id: p.id,
    invoiceId: p.invoice.id,
    paidAt: p.paidAt.toISOString(),
    amount: Number(p.amount),
    method: p.method,
    methodLabel: paymentMethodLabel(p.method, p.channelCode),
    reference: p.reference,
    invoiceNumber: p.invoice.invoiceNumber,
    studentName: p.invoice.student.name,
  }));

  const byMethod = methodSummary
    .map((m) => ({
      method: m.method,
      methodLabel: paymentMethodLabel(m.method),
      amount: Number(m._sum.amount ?? 0),
      count: m._count._all,
    }))
    .sort((a, b) => b.amount - a.amount);
  const totalAmount = byMethod.reduce((sum, m) => sum + m.amount, 0);
  const totalCount = byMethod.reduce((sum, m) => sum + m.count, 0);

  return {
    rows,
    summary: { totalAmount, totalCount, byMethod },
  };
}

/** Quote a CSV cell, escaping quotes (RFC 4180) + neutralizing formula
 * triggers — student name and reference are semi-untrusted free text. */
function csvCell(value: string | null): string {
  let v = value ?? "";
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

/** Format an ISO timestamp as a Jakarta YYYY-MM-DD HH:mm for the CSV. */
function formatJakartaDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function buildLedgerCsv(rows: LedgerRow[]): string {
  const header = "Tanggal,Siswa,No. Tagihan,Metode,Referensi,Jumlah";
  const lines = rows.map((r) =>
    [
      csvCell(formatJakartaDateTime(r.paidAt)),
      csvCell(r.studentName),
      csvCell(r.invoiceNumber),
      csvCell(r.methodLabel),
      csvCell(r.reference),
      r.amount,
    ].join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
