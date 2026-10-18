import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceReceiptPdf } from "@/lib/pdf/invoice-receipt";
import { RECEIPT_INVOICE_SELECT, buildReceiptData } from "@/lib/pdf/receipt-data";
import { hasReceipt } from "@/lib/finance/invoice-receipt";
import React from "react";

/**
 * GET /api/invoices/[id]/pdf
 * Admin kuitansi (FINX-9): the same receipt PDF a guardian downloads, for
 * finance staff who can record payments. Tenant-scoped; only invoices that
 * have received money have a receipt, whatever their status label (a partly
 * paid invoice that turned Lewat Tempo keeps it).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, tenantId: session.tenantId },
    select: RECEIPT_INVOICE_SELECT,
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!hasReceipt(invoice)) {
    return NextResponse.json(
      { error: "Kuitansi hanya tersedia untuk tagihan yang sudah dibayar." },
      { status: 409 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true },
  });

  const data = buildReceiptData(invoice, tenant?.name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(InvoiceReceiptPdf, { data }) as any);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="kuitansi-${invoice.invoiceNumber}.pdf"`,
    },
  });
}
