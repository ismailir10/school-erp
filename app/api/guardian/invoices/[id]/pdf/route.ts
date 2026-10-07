import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_PAYMENT_FILTER } from "@/lib/finance/invoice-payment-state";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceReceiptPdf, InvoiceReceiptData } from "@/lib/pdf/invoice-receipt";
import React from "react";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";
import { parentPaymentMethodLabel } from "@/lib/parent-payment-method";

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
    select: {
      id: true,
      invoiceNumber: true,
      periodLabel: true,
      dueDate: true,
      totalDue: true,
      totalPaid: true,
      status: true,
      paidAt: true,
      tenantId: true,
      studentId: true,
      lines: {
        select: {
          id: true,
          labelSnapshot: true,
          amount: true,
          finalAmount: true,
        },
        orderBy: { feeComponent: { sortOrder: "asc" } },
      },
      payments: {
        // A reversed manual payment is not money received — keep it out of the
        // parent's history and the receipt, consistent with totalPaid.
        where: ACTIVE_PAYMENT_FILTER,
        select: {
          id: true,
          amount: true,
          method: true,
          reference: true,
          paidAt: true,
        },
        orderBy: { paidAt: "desc" },
      },
      student: {
        select: {
          name: true,
          nickname: true,
          enrollments: {
            where: {
              status: "ACTIVE",
              // Exclude ARCHIVED-year rows. Un-closed prior-year ACTIVE
              // enrollments (bulk-import artifact — see T9 regression,
              // docs/cycles/2026-08-21-enrollment-flexibility.md) would
              // otherwise sit in `pickPrimaryEnrollment`'s pool alongside
              // the real current-year row and can win its earliest-
              // enrollDate tiebreak, naming last year's class + program on
              // the receipt header.
              classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
            },
            // No `take: 1` — a dual-enrolled student (sekolah + daycare)
            // needs every ACTIVE row so `pickPrimaryEnrollment` below can
            // pick the SEMESTER one. A receipt header must be singular.
            select: {
              id: true,
              enrollDate: true,
              classSection: {
                select: {
                  name: true,
                  program: { select: { name: true, type: true } },
                },
              },
            },
          },
        },
      },
    },
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://talib.annisaasekolahku.com";

  const fmtIdDate = (d: Date | string) =>
    new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  const fmtIdDateShort = (d: Date | string) =>
    new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

  const totalDue = Number(invoice.totalDue);
  const totalPaid = Number(invoice.totalPaid);

  const primaryEnrollment =
    invoice.student.enrollments.length <= 1
      ? (invoice.student.enrollments[0] ?? null)
      : pickPrimaryEnrollment(invoice.student.enrollments);

  const data: InvoiceReceiptData = {
    schoolName: tenant?.name ?? "School",
    logoUrl: `${appUrl}/logo.png`,
    invoiceNumber: invoice.invoiceNumber,
    periodLabel: invoice.periodLabel,
    dueDate: fmtIdDate(invoice.dueDate),
    paidAt: invoice.paidAt ? fmtIdDate(invoice.paidAt) : null,
    studentName: invoice.student.name,
    studentNickname: invoice.student.nickname,
    className: primaryEnrollment?.classSection?.name ?? null,
    programName: primaryEnrollment?.classSection?.program.name ?? null,
    lines: invoice.lines.map((l) => ({
      label: l.labelSnapshot,
      amount: Number(l.finalAmount ?? l.amount),
    })),
    totalDue,
    totalPaid,
    remaining: Math.max(0, totalDue - totalPaid),
    payments: invoice.payments.map((p) => ({
      paidAt: fmtIdDateShort(p.paidAt),
      method: parentPaymentMethodLabel(p.method),
      reference: p.reference,
      amount: Number(p.amount),
    })),
    generatedDate: fmtIdDate(new Date()),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(InvoiceReceiptPdf, { data }) as any);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="kuitansi-${invoice.invoiceNumber}.pdf"`,
    },
  });
}
