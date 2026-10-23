import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { resolveAppOrigin } from "@/lib/payments/session";
import { canRemindInvoice, guardianChatNumber, invoiceReminderWaUrl } from "@/lib/finance/invoice-reminder";
import { invoiceRemaining } from "@/lib/finance/reminder-queue";
import { getInvoiceReminderTemplate } from "@/lib/finance/reminder-template-store";

/**
 * POST /api/invoices/[id]/reminder — records that an admin opened a WhatsApp reminder
 * for this invoice (cycle 2026-10-17-payment-link-reminders, D6/D7). No body.
 *
 * Stamps `lastRemindedAt`, `lastRemindedBy` and bumps `remindCount`, with an audit row
 * in the same transaction (a failed audit rolls the stamp back). The app only OPENS
 * WhatsApp, the admin presses send, so this means "diingatkan", never "terkirim".
 * Answers with the same `wa.me` URL the queue builds so the caller can open it right
 * after stamping; with no payment link it points at the parent portal, like the detail
 * page's existing button.
 *
 *   403  not an admin with `payments.record`
 *   404  no such invoice in this tenant
 *   409  nothing to chase now (draft, awaiting link, paid, cancelled, or nothing left to pay)
 *   422  the primary guardian has no number WhatsApp can open
 *   429  rate limited
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`invoice-reminder:${session.id}`, 60, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  const { tenantId } = session;
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      invoiceNumber: true,
      periodLabel: true,
      status: true,
      totalDue: true,
      totalPaid: true,
      xenditPaymentUrl: true,
      lastRemindedAt: true,
      lastRemindedBy: true,
      remindCount: true,
      student: {
        select: {
          name: true,
          guardians: {
            where: { isPrimary: true, status: "ACTIVE" },
            take: 1,
            select: { parent: { select: { name: true, whatsapp: true, phone: true } } },
          },
        },
      },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const remaining = invoiceRemaining(invoice);
  if (!canRemindInvoice({ status: invoice.status, remaining })) {
    return NextResponse.json({ error: "Tagihan ini tidak perlu diingatkan sekarang." }, { status: 409 });
  }

  const guardian = invoice.student.guardians[0]?.parent ?? null;
  if (!guardianChatNumber(guardian)) {
    return NextResponse.json({ error: "Belum ada nomor WhatsApp orang tua yang bisa dihubungi." }, { status: 422 });
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.invoice.update({
      where: { id: invoice.id },
      data: { lastRemindedAt: now, lastRemindedBy: session.id, remindCount: { increment: 1 } },
      select: { lastRemindedAt: true, remindCount: true },
    });
    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "Invoice",
        entityId: invoice.id,
        action: "remind",
        before: {
          lastRemindedAt: invoice.lastRemindedAt?.toISOString() ?? null,
          lastRemindedBy: invoice.lastRemindedBy,
          remindCount: invoice.remindCount,
        },
        after: {
          lastRemindedAt: now.toISOString(),
          lastRemindedBy: session.id,
          remindCount: row.remindCount,
        },
      },
      tx,
    );
    return row;
  });

  const waUrl = invoiceReminderWaUrl({
    guardian,
    studentName: invoice.student.name,
    invoiceNumber: invoice.invoiceNumber,
    periodLabel: invoice.periodLabel,
    remaining,
    payUrl: invoice.xenditPaymentUrl ?? `${resolveAppOrigin(new URL(req.url).origin)}/parent/invoices`,
    template: await getInvoiceReminderTemplate(tenantId),
  });

  return NextResponse.json({
    lastRemindedAt: (updated.lastRemindedAt ?? now).toISOString(),
    remindCount: updated.remindCount,
    waUrl,
  });
}
