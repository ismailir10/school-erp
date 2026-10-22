import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_PAYMENT_FILTER } from "@/lib/finance/invoice-payment-state";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";
import { schoolContactPhone } from "@/lib/contact";

/**
 * GET /api/guardian/invoices/[id]
 * Guardian-scoped invoice detail — returns lines, payments, and student info.
 * Only accessible by GUARDIAN role, only for their own children's invoices.
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
      guardians: { where: { status: "ACTIVE" }, select: { studentId: true } },
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
      xenditPaymentUrl: true,
      sentAt: true,
      paidAt: true,
      tenantId: true,
      studentId: true,
      lines: {
        select: {
          id: true,
          labelSnapshot: true,
          amount: true,
          finalAmount: true,
          adjustmentAmount: true,
          adjustmentNote: true,
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
              // the invoice header.
              classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
            },
            // No `take: 1` — a dual-enrolled student (sekolah + daycare)
            // needs every ACTIVE row so `pickPrimaryEnrollment` below can
            // pick the SEMESTER one. An invoice header must be singular.
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

  const primaryEnrollment =
    invoice.student.enrollments.length <= 1
      ? (invoice.student.enrollments[0] ?? null)
      : pickPrimaryEnrollment(invoice.student.enrollments);

  // Serialize Decimals and Dates (tenantId excluded from response)
  return NextResponse.json({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    periodLabel: invoice.periodLabel,
    dueDate: invoice.dueDate,
    totalDue: Number(invoice.totalDue),
    totalPaid: Number(invoice.totalPaid),
    status: invoice.status,
    xenditPaymentUrl: invoice.xenditPaymentUrl,
    // PAR-7: shown when the invoice has no payment link. Null when the school
    // has not configured SCHOOL_CONTACT_PHONE.
    schoolContactPhone: schoolContactPhone(),
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    lines: invoice.lines.map((l) => ({
      id: l.id,
      labelSnapshot: l.labelSnapshot,
      amount: Number(l.amount),
      finalAmount: Number(l.finalAmount),
      adjustmentAmount: Number(l.adjustmentAmount),
      adjustmentNote: l.adjustmentNote,
    })),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt.toISOString(),
    })),
    student: {
      name: invoice.student.name,
      nickname: invoice.student.nickname,
      classSection: primaryEnrollment?.classSection
        ? {
            name: primaryEnrollment.classSection.name,
            program: { name: primaryEnrollment.classSection.program.name },
          }
        : null,
    },
  });
}
