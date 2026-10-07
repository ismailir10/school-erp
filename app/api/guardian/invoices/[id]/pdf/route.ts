import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceReceiptPdf } from "@/lib/pdf/invoice-receipt";
import { RECEIPT_INVOICE_SELECT, buildReceiptData } from "@/lib/pdf/receipt-data";
import React from "react";

/**
 * GET /api/guardian/invoices/[id]/pdf
 * Returns the paid-invoice receipt (kuitansi) PDF for a guardian.
 * Only accessible by GUARDIAN role, only for their own children's PAID invoices.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.tenantId || session.role !== "GUARDIAN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Verify this invoice belongs to one of the guardian's children.
  // Same parentId-or-nonempty-email guard as the raport-PDF route: a session
  // carrying neither would match the first null-email parent in the tenant —
  // a cross-family leak. Flat 404 on the degenerate session, same as a miss.
  const hasEmail = typeof session.email === "string" && session.email.length > 0;
  if (!session.parentId && !hasEmail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const guardian = await prisma.parent.findFirst({
    where: session.parentId
      ? { id: session.parentId, tenantId: session.tenantId }
      : { email: session.email, tenantId: session.tenantId },
    select: {
      guardians: { select: { studentId: true } },
    },
  });

  if (!guardian) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const childIds = new Set(guardian.guardians.map((g) => g.studentId));

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: RECEIPT_INVOICE_SELECT,
  });

  if (!invoice || !childIds.has(invoice.studentId) || invoice.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Paid-status guard — no leaked draft/unpaid receipts
  if (invoice.status !== "PAID") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: invoice.tenantId },
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
