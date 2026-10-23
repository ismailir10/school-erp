import { invoiceCapabilities } from "@/lib/finance/invoice-capabilities";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { updateInvoiceSchema } from "@/lib/validations/invoice";
import { hasPermission } from "@/lib/permissions";
import { paymentProblemsFrom } from "@/lib/finance/payment-problems";
import { NEEDS_REVIEW_ERROR_CODES } from "@/lib/payments/needs-review";
import { getInvoiceReminderTemplate } from "@/lib/finance/reminder-template-store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.view")) return NextResponse.json(null, { status: 403 });

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      student: { include: { guardians: { where: { isPrimary: true, status: "ACTIVE" }, take: 1, include: { parent: true } } } },
      lines: { include: { feeComponent: { select: { code: true, category: true } } }, orderBy: { feeComponent: { sortOrder: "asc" } } },
      payments: { orderBy: { paidAt: "desc" } },
    },
  });

  if (!invoice || invoice.tenantId !== session.tenantId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // FIN-7: Payment.createdBy is a bare User id (no relation) — resolve names
  // here, tenant-scoped, so the history can say "Dicatat oleh <nama>".
  // The reminder's actor (also a bare User id) rides the same lookup.
  const actorIds = [
    ...new Set([...invoice.payments.map((p) => p.createdBy), invoice.lastRemindedBy].filter((v): v is string => !!v)),
  ];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds }, tenantId: session.tenantId },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorName = new Map(actors.map((u) => [u.id, u.name || u.email]));
  const payments = invoice.payments.map((p) => ({
    ...p,
    createdByName: p.createdBy ? (actorName.get(p.createdBy) ?? null) : null,
  }));

  // Gateway money that needs a person ("Perlu dicek"). WebhookEvent has no tenantId: the scope is
  // the tenant-checked invoice id above. Not filtered by provider: a flag from a previous gateway
  // still matters.
  const flaggedEvents = await prisma.webhookEvent.findMany({
    where: { invoiceId: invoice.id, status: "ERROR", errorMessage: { in: [...NEEDS_REVIEW_ERROR_CODES] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { errorMessage: true, payload: true, provider: true, createdAt: true },
  });

  return NextResponse.json({
    ...invoice,
    payments,
    paymentProblems: paymentProblemsFrom(flaggedEvents),
    lastRemindedByName: invoice.lastRemindedBy ? (actorName.get(invoice.lastRemindedBy) ?? null) : null,
    // The page writes the WhatsApp link itself, so it needs the school's wording (null = default).
    reminderTemplate: await getInvoiceReminderTemplate(session.tenantId),
    capabilities: invoiceCapabilities(session),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.invoice.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== session.tenantId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = updateInvoiceSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  // FINX-3: PUT only ever moves DRAFT -> SENT. Every other target status has a
  // dedicated owner — void route cancels, the payment ledger drives
  // PARTIALLY_PAID/PAID, and the rest are system-managed — so a direct write
  // would desync status from payments (a Rp 299.000 balance shown as "Lunas").
  if (body.status && body.status !== "SENT") {
    const message =
      body.status === "CANCELLED"
        ? "Gunakan Batalkan tagihan untuk membatalkan tagihan."
        : body.status === "PAID" || body.status === "PARTIALLY_PAID"
          ? "Status lunas mengikuti pembayaran yang dicatat. Gunakan Catat Pembayaran."
          : "Status tagihan tidak bisa diubah langsung.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  // State-machine guard: only DRAFT -> SENT is valid via PUT. Xendit session
  // creation lives on the dedicated POST endpoints (manual create, batch,
  // retry-payment-links); this guard preserves status-machine purity so a
  // stale admin tab can't jump straight to SENT and bypass those paths.
  if (body.status === "SENT" && existing.status !== "DRAFT" && existing.status !== "SENT") {
    return NextResponse.json(
      { error: `Tagihan dengan status ${existing.status} tidak bisa diubah ke SENT` },
      { status: 409 }
    );
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      status: body.status ?? existing.status,
      sentAt: body.status === "SENT" ? new Date() : existing.sentAt,
    },
  });

  // Bust the parent-portal Tagihan cache. Without this the parent sees the
  // old status until the 120s revalidate window — long enough that home and
  // /parent/invoices can disagree (UAT-2026-05-03 INV-01 vector).
  if (body.status && body.status !== existing.status) {
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
  }

  return NextResponse.json({ ...invoice, capabilities: invoiceCapabilities(session) });
}
