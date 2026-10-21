import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { isGatewayPayment } from "@/lib/constants/payment-methods";
import { invoiceStatusLabel, VOIDABLE_INVOICE_STATUSES } from "@/lib/constants/invoice-status";
import { ACTIVE_PAYMENT_FILTER } from "@/lib/finance/invoice-payment-state";
import { formatRupiah } from "@/lib/format";
import { LINK_CLEARED } from "@/lib/payments/link-cleared";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.void")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Serialize with the Xendit webhook + manual payments via the same
  // advisory lock so a payment cannot be credited between the status
  // check and the void write.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const fresh = await tx.invoice.findUnique({ where: { id } });
      if (!fresh || fresh.tenantId !== session.tenantId) {
        throw new Error("NOT_FOUND");
      }
      if (fresh.status === "CANCELLED") throw new Error("ALREADY_CANCELLED");

      // Money already booked on the invoice blocks a cancel: cancelling would
      // leave received cash on a dead invoice. Manual payments must be
      // reversed first (FIN-9); gateway payments cannot be reversed here.
      const active = await tx.payment.findMany({
        where: { invoiceId: id, ...ACTIVE_PAYMENT_FILTER, amount: { gt: 0 } },
        select: { amount: true, method: true, xenditPaymentId: true },
      });
      // fresh.totalPaid is the belt to the payment rows' braces: a legacy row
      // can carry a paid total without payment rows behind it.
      if (active.length > 0 || Number(fresh.totalPaid) > 0) {
        const total = Math.max(
          active.reduce((sum, p) => sum + Number(p.amount), 0),
          Number(fresh.totalPaid),
        );
        throw Object.assign(new Error("HAS_PAYMENTS"), {
          total,
          gateway: active.some((p) => isGatewayPayment(p)),
        });
      }

      const voidable =
        (VOIDABLE_INVOICE_STATUSES as readonly string[]).includes(fresh.status) ||
        fresh.status === "PARTIALLY_PAID"; // all payments reversed -> nothing owed
      if (!voidable) {
        throw Object.assign(new Error("INVALID_STATE"), { status: fresh.status });
      }
      // Clear Xendit fields alongside the status flip. Closes the TOCTOU
      // race where the retry helper writes xenditSessionId/Url after this
      // void commits — last-write-wins leaves a live link on a CANCELLED
      // invoice that the parent could still pay; the webhook's CANCELLED
      // guard handles the late payment but clearing the fields here is the
      // belt-and-suspenders fix.
      await tx.invoice.update({
        where: { id },
        data: {
          status: "CANCELLED",
          ...LINK_CLEARED,
          paymentLinkError: null,
        },
      });
      await recordAudit(
        {
          tenantId: session.tenantId!,
          actorId: session.id,
          entity: "Invoice",
          entityId: id,
          action: "void",
          before: { status: fresh.status },
          after: { status: "CANCELLED" },
        },
        tx,
      );
    });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return NextResponse.json({ error: "Tagihan tidak ditemukan" }, { status: 404 });
      if (e.message === "ALREADY_CANCELLED") {
        return NextResponse.json({ error: "Tagihan ini sudah dibatalkan." }, { status: 409 });
      }
      if (e.message === "HAS_PAYMENTS") {
        const { total, gateway } = e as Error & { total: number; gateway: boolean };
        return NextResponse.json(
          {
            error: gateway
              ? `Tagihan ini sudah menerima pembayaran ${formatRupiah(total)}, termasuk lewat gateway yang tidak bisa dibatalkan dari sini. Tagihan tidak bisa dibatalkan.`
              : `Tagihan ini sudah menerima pembayaran ${formatRupiah(total)}. Batalkan pembayarannya lebih dulu di Riwayat Pembayaran, lalu batalkan tagihan.`,
          },
          { status: 409 },
        );
      }
      if (e.message === "INVALID_STATE") {
        return NextResponse.json(
          {
            error: `Tagihan berstatus ${invoiceStatusLabel((e as Error & { status: string }).status)} tidak bisa dibatalkan.`,
          },
          { status: 409 },
        );
      }
    }
    throw e;
  }

  // Void flips status to CANCELLED — bust caches so the parent stops seeing
  // it under outstanding (UAT-2026-05-03 INV-01 vector).
  revalidateTag("parent-invoice-list", { expire: 0 });
  revalidateTag("student-invoices", { expire: 0 });
  return NextResponse.json({ ok: true });
}
