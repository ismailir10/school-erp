import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { Prisma } from "@/lib/generated/prisma/client";
import { sppPrepayConfirmSchema } from "@/lib/validations/spp-prepay";
import { reserveInvoiceNumbers } from "@/lib/finance/invoice-numbers";
import { PaymentError, recordPaymentInTx } from "@/lib/finance/record-payment";
import {
  fingerprintPlan,
  loadSppPrepayContext,
  planForContext,
  remainingOfInvoice,
  type SppPrepayContext,
  type SppPrepayPlan,
} from "@/lib/finance/spp-prepay-load";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

// Up to 12 invoices, each with lines and a payment, in one transaction.
export const maxDuration = 30;

const STALE_MESSAGE = "Data berubah sejak pratinjau. Muat ulang pratinjau lalu coba lagi.";
/** Default reference of the one-time invoice's payment (the SPP payments default to "SPP di muka TA …"). */
const OTHER_FEES_REFERENCE = "Pembayaran di muka";

/** Thrown inside the transaction to roll it back and answer with this status and body. */
class Abort extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.code ?? body.error));
  }
}

type Outcome =
  | { replayed: true }
  | {
      replayed: false;
      created: number;
      settled: number;
      skipped: number;
      total: number;
      reference: string;
      invoiceIds: string[];
      /** The new invoice for the one-time lines, or null when that part was not given. */
      otherFees: { invoiceId: string; invoiceNumber: string; total: number } | null;
    };

/**
 * POST /api/invoices/spp-prepay
 *
 * Confirm half of "Catat pembayaran di muka" (cycles 2026-10-27-paid-invoice-spp-prepay.md
 * and 2026-10-30-prepay-other-fees.md). Two optional parts, at least one: SPP months
 * (settle or create one paid invoice per month) and one-time fees (ONE new invoice, SENT
 * and sent-stamped, paid in full, payment key `<key>:other`, created after the SPP months).
 * Everything happens in ONE transaction, all or nothing. Never calls the payment
 * gateway and never schedules a relink: a settled invoice has its old link
 * cleared (D9) and a created one never gets a link (D4).
 *
 * LOCK ORDER (every transaction that touches these rows must follow it, so two
 * of them can never wait on each other):
 *   1. the student lock  pg_advisory_xact_lock(hashtext('spp-prepay:' || studentId))
 *      - serialises two prepays of the same student;
 *   2. the invoice locks pg_advisory_xact_lock(hashtext(invoiceId)) of every
 *      invoice that will be settled, in ASCENDING id order. Taken before the
 *      balances used for the payments are read, so they are the locked ones.
 *      `recordPaymentInTx` takes the same invoice lock again (re-entrant), and
 *      it is the lock the payments route and the Xendit webhook take, so a
 *      concurrent payment on one of these invoices waits instead of racing.
 * The invoice-number sequence row is touched last (once, after the settles; it also numbers
 * the one-time invoice, which is created after the SPP months). The new one-time invoice
 * cannot be locked by anyone else before it exists.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (
    !session?.tenantId ||
    !isAdminRole(session.role) ||
    !hasPermission(session, "invoices.create") ||
    !hasPermission(session, "payments.record")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!rateLimit(`spp-prepay:${session.id}`, 10, 60_000).success) {
    return NextResponse.json(
      { error: "Terlalu banyak pencatatan dalam waktu singkat. Tunggu sebentar lalu coba lagi." },
      { status: 429 },
    );
  }

  const rawBody = await req.json().catch(() => null);
  const result = await validateBody(sppPrepayConfirmSchema, rawBody);
  if (result.error) return result.error;
  const { studentId, method, paidAt, idempotencyKey, fingerprint, otherFees } = result.data;
  const from = result.data.from ?? undefined;
  const to = result.data.to ?? undefined;
  const tenantId = session.tenantId;
  const actorId = session.id;
  const adminReference = result.data.reference?.trim() || null;
  const adminNote = result.data.notes?.trim() || null;

  // Same hash on every payment of this request: a retry with different details is refused.
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        studentId,
        from: from ?? null,
        to: to ?? null,
        otherFees: otherFees
          ? { label: otherFees.label, lines: otherFees.lines.map((l) => [l.feeComponentId, l.amount]) }
          : null,
        method,
        paidAt,
        reference: adminReference,
        notes: adminNote,
      }),
    )
    .digest("hex");
  // Back-dated payments are stored at 00:00 Asia/Jakarta of the chosen day; today keeps `now`.
  const todayYmd = getTodayInTimezone("Asia/Jakarta");
  const backdatedPaidAt = paidAt < todayYmd ? new Date(`${paidAt}T00:00:00+07:00`) : null;

  try {
    const outcome = await prisma.$transaction(
      async (tx): Promise<Outcome> => {
        // (1) Student lock.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`spp-prepay:${studentId}`}))`;

        // (2) Replay: a payment of this key already exists, so the first request committed.
        const prior = await tx.payment.findFirst({
          where: { idempotencyKey: { startsWith: `${idempotencyKey}:` }, invoice: { tenantId, studentId } },
          select: { requestHash: true },
        });
        if (prior) {
          if (prior.requestHash !== requestHash) {
            throw new Abort(409, {
              error:
                "Pembayaran ini sudah dicatat dengan rincian berbeda. Periksa riwayat pembayaran sebelum mencatat lagi.",
              code: "RETRY_MISMATCH",
            });
          }
          return { replayed: true };
        }

        // (3) + (4) Load and plan inside the transaction, lock the invoices to settle in
        // ascending id order, then read again so the balances are the locked ones. If the
        // second read wants an invoice we did not lock (one changed state meanwhile),
        // lock it too and read once more; a plan that keeps moving is stale.
        const locked = new Set<string>();
        let state: { ctx: SppPrepayContext; plan: SppPrepayPlan } | null = null;
        for (let round = 0; round < 4 && !state; round++) {
          const loaded = await loadSppPrepayContext(tx, { tenantId, studentId, from, to });
          if (!loaded.ok) {
            throw new Abort(loaded.code === "STUDENT_NOT_FOUND" ? 404 : 400, {
              error: loaded.message,
              code: loaded.code,
            });
          }
          const plan = planForContext(loaded, otherFees);
          const unlocked = plan.rows
            .filter((r) => r.action === "SETTLE")
            .flatMap((r) => r.invoiceIds)
            .filter((id) => !locked.has(id))
            .sort();
          if (unlocked.length === 0) {
            state = { ctx: loaded, plan };
            break;
          }
          for (const id of unlocked) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
            locked.add(id);
          }
        }
        if (!state) throw new Abort(409, { error: STALE_MESSAGE, code: "PREVIEW_STALE" });
        const { ctx, plan } = state;

        // (5) The plan must be the one the admin saw.
        if (fingerprintPlan(plan, ctx.invoices) !== fingerprint) {
          throw new Abort(409, { error: STALE_MESSAGE, code: "PREVIEW_STALE" });
        }

        // (6) Nothing to do, or something that cannot be done.
        const blocking = plan.issues.find((i) => i.blocking);
        if (plan.blocked || blocking) {
          throw new Abort(400, {
            error: blocking?.message ?? "Pembayaran di muka belum bisa dicatat.",
            code: blocking?.code ?? "BLOCKED",
          });
        }
        const settleRows = plan.rows.filter((r) => r.action === "SETTLE");
        const createRows = plan.rows.filter((r) => r.action === "CREATE");
        const otherPlan = plan.otherFees;
        if (settleRows.length === 0 && createRows.length === 0 && !otherPlan) {
          throw new Abort(409, {
            error: "Semua bulan dalam rentang ini sudah lunas. Tidak ada yang perlu dicatat.",
            code: "NOTHING_TO_RECORD",
          });
        }

        const periodKey = (r: { year: number; month: number }) =>
          `${r.year}-${String(r.month).padStart(2, "0")}`;
        // The SPP part's group label and note exist only when SPP months were planned.
        const sppGroupLabel =
          ctx.academicYear && plan.rows.length > 0 ? `SPP di muka TA ${ctx.academicYear.name}` : null;
        const sppReference = adminReference ?? sppGroupLabel ?? OTHER_FEES_REFERENCE;
        const sppNotes = sppGroupLabel
          ? `${sppGroupLabel} (${plan.rows[0].periodLabel} – ${plan.rows[plan.rows.length - 1].periodLabel})` +
            (adminNote ? ` — ${adminNote}` : "")
          : adminNote;
        const pay = (
          invoiceId: string,
          amount: (typeof plan.rows)[number]["amount"],
          key: string,
          text: { reference: string; notes: string | null } = { reference: sppReference, notes: sppNotes },
        ) =>
          recordPaymentInTx(tx, {
            invoiceId,
            tenantId,
            actorId,
            amount,
            method,
            reference: text.reference,
            notes: text.notes,
            paidAt: backdatedPaidAt,
            idempotencyKey: key,
            requestHash,
            todayYmd,
            // Settling an invoice that has a gateway link: the app forgets the link (D9).
            linkPolicy: "clear-link",
          });

        const invoiceIds: string[] = [];

        // (7) Settle existing invoices in ascending id order, each for its locked remaining balance.
        const invoiceById = new Map(ctx.invoices.map((inv) => [inv.id, inv]));
        const settles = settleRows
          .flatMap((row) => row.invoiceIds.map((invoiceId) => ({ row, invoiceId })))
          .sort((a, b) => (a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0));
        for (const { row, invoiceId } of settles) {
          const inv = invoiceById.get(invoiceId);
          if (!inv) throw new Abort(409, { error: STALE_MESSAGE, code: "PREVIEW_STALE" });
          // One payment key per month; a month with several settled invoices adds the invoice id.
          const key =
            row.invoiceIds.length > 1
              ? `${idempotencyKey}:${periodKey(row)}:${invoiceId}`
              : `${idempotencyKey}:${periodKey(row)}`;
          await pay(invoiceId, remainingOfInvoice(inv), key);
          invoiceIds.push(invoiceId);
        }

        // (8) Invoice numbers, once, after the settles (the sequence row is the last lock taken).
        const numberCount = createRows.length + (otherPlan ? 1 : 0);
        const numbers = numberCount > 0 ? await reserveInvoiceNumbers(tx, tenantId, numberCount) : [];

        // (9) Create each missing month as a sent invoice and pay it in full.
        for (const [i, row] of createRows.entries()) {
          const invoiceNumber = numbers[i];
          const invoice = await tx.invoice.create({
            data: {
              tenantId,
              studentId,
              parentId: ctx.parentId,
              invoiceNumber,
              periodLabel: row.periodLabel,
              dueDate: row.dueDate,
              totalDue: row.amount,
              status: "SENT",
              sentAt: new Date(),
              createdBy: actorId,
              lines: {
                create: row.lines.map((l) => ({
                  feeComponentId: l.feeComponentId,
                  labelSnapshot: l.labelSnapshot,
                  amount: l.amount,
                  adjustmentAmount: l.adjustmentAmount,
                  adjustmentNote: l.adjustmentNote,
                  finalAmount: l.finalAmount,
                })),
              },
            },
            select: { id: true },
          });
          await pay(invoice.id, row.amount, `${idempotencyKey}:${periodKey(row)}`);
          await recordAudit(
            {
              tenantId,
              actorId,
              entity: "Invoice",
              entityId: invoice.id,
              action: "create",
              after: {
                invoiceNumber,
                periodLabel: row.periodLabel,
                totalDue: row.amount.toString(),
                source: "spp-prepay",
              },
            },
            tx,
          );
          invoiceIds.push(invoice.id);
        }

        // (10) The one-time invoice, after the SPP months: SENT and sent-stamped (a later reversal
        // falls back to Terkirim / Lewat Tempo, never to an invisible DRAFT), due on the paid date,
        // paid in full under the key `<key>:other`. No gateway call, no relink.
        let otherInvoice: { invoiceId: string; invoiceNumber: string; total: number } | null = null;
        if (otherPlan) {
          const invoiceNumber = numbers[createRows.length];
          const invoice = await tx.invoice.create({
            data: {
              tenantId,
              studentId,
              parentId: ctx.parentId,
              invoiceNumber,
              periodLabel: otherPlan.label,
              dueDate: paidAt,
              totalDue: otherPlan.total,
              status: "SENT",
              sentAt: new Date(),
              createdBy: actorId,
              lines: {
                create: otherPlan.lines.map((l) => ({
                  feeComponentId: l.feeComponentId,
                  labelSnapshot: l.label,
                  amount: l.amount,
                  adjustmentAmount: new Prisma.Decimal(0),
                  adjustmentNote: null,
                  finalAmount: l.amount,
                })),
              },
            },
            select: { id: true },
          });
          await pay(invoice.id, otherPlan.total, `${idempotencyKey}:other`, {
            reference: adminReference ?? OTHER_FEES_REFERENCE,
            notes: otherPlan.label + (adminNote ? ` — ${adminNote}` : ""),
          });
          await recordAudit(
            {
              tenantId,
              actorId,
              entity: "Invoice",
              entityId: invoice.id,
              action: "create",
              after: {
                invoiceNumber,
                periodLabel: otherPlan.label,
                totalDue: otherPlan.total.toString(),
                source: "spp-prepay",
                part: "other-fees",
              },
            },
            tx,
          );
          invoiceIds.push(invoice.id);
          otherInvoice = { invoiceId: invoice.id, invoiceNumber, total: Number(otherPlan.total) };
        }

        return {
          replayed: false,
          created: createRows.length,
          settled: settles.length,
          skipped: plan.rows.filter((r) => r.action === "SKIP_PAID").length,
          total: Number(plan.total),
          reference: sppReference,
          invoiceIds,
          otherFees: otherInvoice,
        };
      },
      { timeout: 15000 },
    );

    if (outcome.replayed) return NextResponse.json({ replayed: true }, { status: 200 });

    // Parent portal caches: the months are Lunas now.
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });

    return NextResponse.json(outcome, { status: 201 });
  } catch (e) {
    if (e instanceof Abort) return NextResponse.json(e.body, { status: e.status });
    if (e instanceof PaymentError) {
      // The whole transaction rolled back: nothing was recorded.
      switch (e.code) {
        case "RETRY_MISMATCH":
          return NextResponse.json(
            {
              error:
                "Pembayaran ini sudah dicatat dengan rincian berbeda. Periksa riwayat pembayaran sebelum mencatat lagi.",
              code: "RETRY_MISMATCH",
            },
            { status: 409 },
          );
        case "NOT_FOUND":
          return NextResponse.json({ error: "Tagihan tidak ditemukan", code: "NOT_FOUND" }, { status: 404 });
        case "CANCELLED":
          return NextResponse.json(
            { error: `Ada tagihan yang dibatalkan. ${STALE_MESSAGE}`, code: "PREVIEW_STALE" },
            { status: 409 },
          );
        case "PAID":
          return NextResponse.json(
            { error: `Ada tagihan yang sudah lunas. ${STALE_MESSAGE}`, code: "PREVIEW_STALE" },
            { status: 409 },
          );
        case "OVERPAYMENT":
          return NextResponse.json(
            { error: `${e.msg ?? "Jumlah pembayaran melebihi sisa tagihan."} ${STALE_MESSAGE}`, code: "PREVIEW_STALE" },
            { status: 409 },
          );
      }
    }
    // Drop studentId from the breadcrumb: it is a student-linked identifier and Prisma
    // errors can echo query parameters.
    console.error("[POST /api/invoices/spp-prepay] unhandled", {
      tenantId,
      err: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    });
    return NextResponse.json({ error: "Gagal mencatat pembayaran di muka" }, { status: 500 });
  }
}
