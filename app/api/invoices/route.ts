import { createHash } from "node:crypto";
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
import { validateBody } from "@/lib/api/validate";
import { fieldErrorResponse } from "@/lib/api/field-errors";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { PaymentError, recordPaymentInTx } from "@/lib/finance/record-payment";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

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
 * Manual single-invoice creation with custom line items. Complements
 * `POST /api/invoices/generate/batch` for one-off charges (late enrollment,
 * sibling discount, mid-year uang pangkal, replacement seragam, field trips,
 * etc.) where the bulk-by-program path doesn't fit.
 *
 * Two modes, picked by the optional `payment` object:
 *
 * Unpaid (no `payment`):
 *   1. Verify caller is admin and student is ACTIVE in this tenant. No class
 *      enrollment is required — SPMB applicants converted to Student are billed
 *      (biaya daftar / uang pangkal) before the next year's classes exist.
 *   2. Verify every fee component belongs to tenant and is enabled.
 *   3. Inside one transaction: allocate next invoice number, create the invoice
 *      with status `PENDING_PAYMENT_LINK` and lines using server-derived
 *      `totalDue` (any client total is ignored), audit it.
 *   4. After commit: best-effort gateway session creation. Success flips status
 *      to SENT and clears any prior `paymentLinkError`. Failure keeps the invoice
 *      durable but persists the error message — admin can retry from the
 *      list/detail UI.
 *   5. Returns 201 with the created invoice plus an optional `xenditError`.
 *
 * Paid ("Sudah dibayar", needs `payments.record` too): the invoice is created
 * already paid in full. No gateway call, no link, no email. One transaction:
 * lock on (tenant, idempotencyKey) → replay check → invoice (SENT, `sentAt`
 * stamped so a later reversal falls back to Terkirim/Lewat Tempo, never to an
 * unrecoverable DRAFT) → `recordPaymentInTx` for the whole total with
 * `clear-link`. A replay of the same key and body returns the first result
 * (200); the same key with a different body is a 409.
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

  if (!rateLimit(`create-invoice:${session.id}`, 30, 60_000).success) {
    return NextResponse.json(
      { error: "Terlalu banyak tagihan dibuat dalam waktu singkat. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const validated = await validateBody(createManualInvoiceSchema, body);
  if (validated.error) return validated.error;

  const { studentId, periodLabel, dueDate, lines, payment } = validated.data;
  const tenantId = session.tenantId;

  // Taking the money is a separate permission from creating the invoice (D13).
  if (payment && !hasPermission(session, "payments.record")) {
    return NextResponse.json(
      { error: "forbidden", missing: "payments.record" },
      { status: 403 },
    );
  }

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

  // Paid-mode inputs, derived once so every retry attempt uses the same values.
  const paid = payment
    ? (() => {
        const reference = payment.reference?.trim() || null;
        const notes = payment.notes?.trim() || null;
        const todayYmd = getTodayInTimezone("Asia/Jakarta");
        return {
          idempotencyKey: payment.idempotencyKey,
          method: payment.method,
          reference,
          notes,
          todayYmd,
          // Same rule as the "Catat Pembayaran" route: a back-dated payment is stored at
          // 00:00 Asia/Jakarta of the chosen day; today keeps the real time of day.
          paidAt: payment.paidAt < todayYmd ? new Date(`${payment.paidAt}T00:00:00+07:00`) : null,
          requestHash: createHash("sha256")
            .update(
              JSON.stringify({
                studentId,
                periodLabel: trimmedLabel,
                dueDate,
                lines: lines.map((l) => ({ feeComponentId: l.feeComponentId, amount: l.amount })),
                method: payment.method,
                paidAt: payment.paidAt,
                reference,
                notes,
              }),
            )
            .digest("hex"),
        };
      })()
    : null;

  // 3-attempt retry loop on P2002 (invoice-number race). Post-T1 the atomic
  // ON CONFLICT allocator makes this physically impossible under normal
  // operation, but we keep the loop as defense against manual-seed corruption
  // or future allocator regression. Jittered backoff 50/150/450ms ± 50ms.
  // Protects both modes: a P2002 rolls the whole transaction back, payment included.
  const RETRY_DELAYS_MS = [50, 150, 450];
  let created: { id: string; replayed: boolean } | null = null;
  let lastP2002: Prisma.PrismaClientKnownRequestError | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      created = await prisma.$transaction(
        async (tx) => {
          if (paid) {
            // One create per (tenant, key): two concurrent submits queue here, the second
            // then finds the first's payment below and replays it.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:create-paid:${paid.idempotencyKey}`}))`;
            const existing = await tx.payment.findFirst({
              where: { idempotencyKey: paid.idempotencyKey, invoice: { tenantId } },
              include: { invoice: true },
            });
            if (existing) {
              if (existing.requestHash !== paid.requestHash) throw new PaymentError("RETRY_MISMATCH");
              return { id: existing.invoiceId, replayed: true };
            }
          }

          const invoiceNumber = await nextInvoiceNumber(tx, tenantId);
          // Server-derived total — any client-provided total is discarded.
          const totalDue = sumDecimals(lines.map((l) => l.amount));

          const invoice = await tx.invoice.create({
            data: {
              tenantId,
              studentId,
              parentId: guardian?.parentId ?? null,
              invoiceNumber,
              periodLabel: trimmedLabel,
              dueDate,
              totalDue,
              // Paid mode is stamped as sent (D3) although nothing is sent.
              status: paid ? "SENT" : "PENDING_PAYMENT_LINK",
              ...(paid ? { sentAt: new Date() } : {}),
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

          let status = "PENDING_PAYMENT_LINK";
          if (paid) {
            const result = await recordPaymentInTx(tx, {
              invoiceId: invoice.id,
              tenantId,
              actorId: session.id,
              amount: totalDue,
              method: paid.method,
              reference: paid.reference,
              notes: paid.notes,
              paidAt: paid.paidAt,
              idempotencyKey: paid.idempotencyKey,
              requestHash: paid.requestHash,
              todayYmd: paid.todayYmd,
              // No gateway link exists and none may be created (D4, D9).
              linkPolicy: "clear-link",
            });
            status = result.invoiceStatus;
          }

          await recordAudit(
            {
              tenantId,
              actorId: session.id,
              entity: "Invoice",
              entityId: invoice.id,
              action: "create",
              after: {
                invoiceNumber,
                periodLabel: trimmedLabel,
                totalDue: totalDue.toString(),
                status,
                paid: !!paid,
              },
            },
            tx,
          );

          return { id: invoice.id, replayed: false };
        },
        paid ? { timeout: 15000 } : undefined,
      );
      break;
    } catch (e) {
      if (e instanceof PaymentError) {
        // The whole transaction rolled back: no invoice, no payment.
        if (e.code === "RETRY_MISMATCH") {
          return NextResponse.json(
            { error: "Pembayaran ini sudah dicatat dengan rincian berbeda. Periksa riwayat pembayaran sebelum mencatat pembayaran baru." },
            { status: 409 },
          );
        }
        if (e.code === "OVERPAYMENT") return fieldErrorResponse("payment", e.msg ?? e.message, 400);
        return NextResponse.json({ error: "Gagal mencatat pembayaran untuk tagihan baru" }, { status: 409 });
      }
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

  // Inline gateway session, unpaid mode only. Failure here is a durable data
  // state, not a transient error — the invoice already exists in
  // `PENDING_PAYMENT_LINK` so admin can retry from the list/detail surface.
  let xenditError: string | undefined;
  if (!paid) {
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
  }

  // Bust parent-portal cache so the new invoice appears on the next
  // /parent/invoices fetch — without this, the 2-minute unstable_cache TTL
  // gates the parent from seeing the bill until it expires. A paid invoice
  // also changes the per-student totals.
  revalidateTag("parent-invoice-list", { expire: 0 });
  if (paid) revalidateTag("student-invoices", { expire: 0 });

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
      status: fresh?.status ?? (paid ? "PAID" : undefined),
      xenditPaymentUrl: fresh?.xenditPaymentUrl ?? null,
      xenditSessionId: fresh?.xenditSessionId ?? null,
      paymentLinkError: fresh?.paymentLinkError ?? null,
      lines: fresh?.lines ?? [],
      ...(paid ? { paid: true } : {}),
      ...(created.replayed ? { replayed: true } : {}),
      ...(xenditError ? { xenditError } : {}),
    },
    { status: created.replayed ? 200 : 201 }
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
