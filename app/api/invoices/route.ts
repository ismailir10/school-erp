import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { Prisma } from "@/lib/generated/prisma/client";
import { nextInvoiceNumber, sumDecimals } from "@/lib/finance/invoice-numbers";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";
import { formatPaymentLinkError } from "@/lib/xendit/error-prefix";
import { createManualInvoiceSchema, invoiceListStatusSchema } from "@/lib/validations/invoice";
import { needsLinkWhere, owingInvoiceWhere } from "@/lib/finance/invoice-owes";
import { needsReviewInvoiceIds } from "@/lib/payments/needs-review-invoices";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["createdAt", "invoiceNumber", "dueDate", "totalDue", "totalPaid", "status", "periodLabel", "paymentLinkExpiresAt"],
    default: "createdAt",
    defaultOrder: "desc",
  });
  if (sort instanceof Response) return sort;
  // Every sort ends in `id` so rows that tie (a batch shares one createdAt/dueDate; most
  // invoices share a null link date) keep one order and paging never repeats or skips a row.
  // The link date is nullable: invoices without one go last in BOTH directions (D6).
  const [[sortKey, sortDir]] = Object.entries(sort.orderBy);
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
    sortKey === "paymentLinkExpiresAt"
      ? { paymentLinkExpiresAt: { sort: sortDir, nulls: "last" } }
      : { [sortKey]: sortDir },
    { id: "asc" },
  ];
  const statusParam = searchParams.get("status");
  const studentId = searchParams.get("studentId");
  const search = escapeLike(cleanSearch(searchParams.get("search")));

  // An unknown status is a 400, not a Prisma enum crash. Blank means "all".
  const statusResult = invoiceListStatusSchema.safeParse(statusParam?.trim() || "all");
  if (!statusResult.success) {
    return NextResponse.json({ error: "Status tagihan tidak dikenal" }, { status: 400 });
  }
  const status = statusResult.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  // "Belum lunas" (UNPAID), "Perlu link" (NEEDS_LINK) and "Perlu dicek" (NEEDS_REVIEW) are
  // derived, not stored statuses (D12). They go under AND so they compose with the search `OR` below. Every other value
  // is a raw status and still works, so old links such as `?status=OVERDUE` keep working.
  if (status === "UNPAID") where.AND = [owingInvoiceWhere()];
  else if (status === "NEEDS_LINK") where.AND = [needsLinkWhere()];
  // The event log has no tenant column, so the id set is only a candidate list: `tenantId`
  // above still scopes it, and an empty set (`in: []`) matches nothing.
  else if (status === "NEEDS_REVIEW") where.AND = [{ id: { in: await needsReviewInvoiceIds() } }];
  else if (status !== "all") where.status = status;
  if (studentId) where.studentId = studentId;
  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { periodLabel: { contains: search, mode: "insensitive" } },
      { student: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take,
      include: {
        student: { select: { name: true, nickname: true } },
        _count: { select: { payments: true } },
      },
      orderBy,
    }),
    prisma.invoice.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(invoices, total, page, pageSize));
}

/**
 * POST /api/invoices
 *
 * Manual single-invoice creation with custom line items + inline Xendit
 * Checkout Session. Complements `POST /api/invoices/generate/batch` for
 * one-off charges (late enrollment, sibling discount, mid-year uang pangkal,
 * replacement seragam, field trips, etc.) where the bulk-by-program path
 * doesn't fit.
 *
 * Flow:
 *   1. Verify caller is admin and student is ACTIVE in this tenant. No class
 *      enrollment is required — SPMB applicants converted to Student are billed
 *      (biaya daftar / uang pangkal) before the next year's classes exist.
 *   2. Verify every fee component belongs to tenant and is enabled.
 *   3. Inside one transaction: allocate next invoice number under advisory
 *      lock, create invoice with status `PENDING_PAYMENT_LINK`, create lines
 *      using server-derived `totalDue` (any client total is ignored).
 *   4. After commit: best-effort Xendit Checkout Session creation. Success
 *      flips status to SENT and clears any prior `paymentLinkError`. Failure
 *      keeps the invoice durable but persists the error message — admin can
 *      retry from the list/detail UI.
 *   5. Returns 201 with the created invoice (including lines + Xendit fields)
 *      plus an optional `xenditError` for the failure case.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "invoices.create")) {
    return NextResponse.json(
      { error: "forbidden", missing: "invoices.create" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createManualInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validasi gagal", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { studentId, periodLabel, dueDate, lines } = parsed.data;
  const tenantId = session.tenantId;

  // Outer try/catch is the only thing that turns an unexpected DB/Xendit/
  // serialisation throw into a structured 500. Without it the user sees the
  // generic "Gagal membuat tagihan" toast with no server-side breadcrumb,
  // which masked a P2002-from-FK incident on staging in 2026-05.
  try {

  // Verify the student is ACTIVE in *this* tenant. Deliberately no class
  // enrollment check: a newly converted SPMB applicant has no class until the
  // next academic year's classes are set up, and still needs a registration
  // invoice. Bulk billing runs remain class-scoped.
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!student) {
    return NextResponse.json(
      { error: "Siswa tidak ditemukan atau tidak aktif" },
      { status: 400 }
    );
  }

  // Verify every fee component is tenant-owned and enabled. The schema-level
  // .refine() rejects duplicate feeComponentIds upstream, so this list is
  // already deduplicated — the count check below verifies "tenant-owned +
  // enabled" only, not dedup.
  const lineFeeIds = lines.map((l) => l.feeComponentId);
  const components = await prisma.feeComponentDef.findMany({
    where: { id: { in: lineFeeIds }, tenantId, isEnabled: true },
    select: { id: true, label: true },
  });
  if (components.length !== lineFeeIds.length) {
    return NextResponse.json(
      { error: "Beberapa komponen biaya tidak valid" },
      { status: 400 }
    );
  }

  // Best-effort lookup — billing parent stays nullable on Invoice.
  const guardian = await prisma.studentGuardian.findFirst({
    where: { studentId, isPrimary: true, status: "ACTIVE" },
    select: { parentId: true },
  });

  const componentLabelById = new Map(components.map((c) => [c.id, c.label]));
  const trimmedLabel = periodLabel.trim();

  // 3-attempt retry loop on P2002 (invoice-number race). Post-T1 the atomic
  // ON CONFLICT allocator makes this physically impossible under normal
  // operation, but we keep the loop as defense against manual-seed corruption
  // or future allocator regression. Jittered backoff 50/150/450ms ± 50ms.
  const RETRY_DELAYS_MS = [50, 150, 450];
  let created: { id: string } | null = null;
  let lastP2002: Prisma.PrismaClientKnownRequestError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      created = await prisma.$transaction(async (tx) => {
        const invoiceNumber = await nextInvoiceNumber(tx, tenantId);
        // Server-derived total — any client-provided total is discarded.
        const totalDue = sumDecimals(lines.map((l) => l.amount));

        return tx.invoice.create({
          data: {
            tenantId,
            studentId,
            parentId: guardian?.parentId ?? null,
            invoiceNumber,
            periodLabel: trimmedLabel,
            dueDate,
            totalDue,
            status: "PENDING_PAYMENT_LINK",
            createdBy: session.id,
            lines: {
              create: lines.map((l) => ({
                feeComponentId: l.feeComponentId,
                labelSnapshot: componentLabelById.get(l.feeComponentId) ?? "",
                amount: new Prisma.Decimal(l.amount),
                finalAmount: new Prisma.Decimal(l.amount),
              })),
            },
          },
          select: { id: true },
        });
      });
      break;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        lastP2002 = e;
        if (attempt < 2) {
          const jitter = Math.random() * 100 - 50;
          const delay = Math.max(0, RETRY_DELAYS_MS[attempt] + jitter);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        // Exhausted retries — surface the conflict to the caller.
        return NextResponse.json(
          { error: "Konflik nomor tagihan, silakan coba lagi" },
          { status: 409 }
        );
      }
      // Any other error bubbles to the route's outer 500 handler.
      throw e;
    }
  }

  if (!created) {
    // Defensive — control flow should already have returned 409 above.
    return NextResponse.json(
      { error: "Konflik nomor tagihan, silakan coba lagi" },
      { status: 409 }
    );
  }
  // Belt-and-suspenders: silence "unused" lint if lastP2002 is set.
  void lastP2002;

  // Inline Xendit. Failure here is a durable data state, not a transient
  // error — the invoice already exists in `PENDING_PAYMENT_LINK` so admin
  // can retry from the list/detail surface.
  let xenditError: string | undefined;
  try {
    const result = await createPaymentSessionForInvoice(created.id, tenantId, new URL(req.url).origin);
    if (result) {
      await prisma.invoice.update({
        where: { id: created.id },
        data: { status: "SENT", sentAt: new Date(), paymentLinkError: null },
      });
    } else {
      // Helper-returns-null is the TOCTOU guard path (PAID/CANCELLED
      // mid-flight, or remaining went to 0). Tag as "unknown:" so it lands
      // in the diagnostic breakdown alongside other untyped failures rather
      // than dropping into the "untagged" bucket.
      xenditError = formatPaymentLinkError(
        new Error("Gagal membuat sesi pembayaran"),
      );
      try {
        await prisma.invoice.update({
          where: { id: created.id },
          data: { paymentLinkError: xenditError },
        });
      } catch {
        // Best-effort write-back; response still surfaces the error below.
      }
    }
  } catch (e) {
    // Prefix-tag with the XenditApiError.code (after retry exhaustion) so
    // /api/invoices/pending-payment-link/breakdown can aggregate by category.
    xenditError = formatPaymentLinkError(e);
    try {
      await prisma.invoice.update({
        where: { id: created.id },
        data: { paymentLinkError: xenditError },
      });
    } catch {
      // Best-effort write-back; response still surfaces the error below.
    }
  }

  // Bust parent-portal cache so the new invoice appears on the next
  // /parent/invoices fetch — without this, the 2-minute unstable_cache TTL
  // gates the parent from seeing the bill until it expires.
  revalidateTag("parent-invoice-list", { expire: 0 });

  // Re-fetch with lines + Xendit fields so the admin UI can surface the link
  // (or error) immediately without a follow-up GET.
  const fresh = await prisma.invoice.findUnique({
    where: { id: created.id },
    include: { lines: true },
  });

  return NextResponse.json(
    {
      id: fresh?.id ?? created.id,
      invoiceNumber: fresh?.invoiceNumber,
      totalDue: fresh?.totalDue,
      status: fresh?.status,
      xenditPaymentUrl: fresh?.xenditPaymentUrl ?? null,
      xenditSessionId: fresh?.xenditSessionId ?? null,
      paymentLinkError: fresh?.paymentLinkError ?? null,
      lines: fresh?.lines ?? [],
      ...(xenditError ? { xenditError } : {}),
    },
    { status: 201 }
  );
  } catch (e) {
    // Drop studentId from the breadcrumb — it is a student-linked identifier
    // and Prisma error messages can echo query parameters. tenantId alone is
    // enough scope for triage.
    console.error("[POST /api/invoices] unhandled", {
      tenantId,
      err: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    });
    return NextResponse.json(
      { error: "Gagal membuat tagihan" },
      { status: 500 }
    );
  }
}
