import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { renderToBuffer } from "@react-pdf/renderer";
import { SalarySlipPdf, SlipData } from "@/lib/pdf/salary-slip";
import { maskBankAccount } from "@/lib/format";
import { formatPeriodRange } from "@/app/teacher/slips/helpers";
import React from "react";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ payrollItemId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { payrollItemId } = await params;

  const item = await prisma.payrollItem.findUnique({
    where: { id: payrollItemId },
    include: {
      employee: true,
      payrollRun: { select: { periodStart: true, periodEnd: true, actualWorkDays: true, tenantId: true } },
      lines: { orderBy: { componentDef: { sortOrder: "asc" } } },
    },
  });

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // PAYROLL SECURITY: Exhaustive role-based access control
  if (session.role === "TEACHER") {
    // Teachers can only see their own slip
    if (item.employee.id !== session.employeeId) {
      return NextResponse.json({ error: "Akses ditolak — Anda hanya dapat melihat slip gaji Anda sendiri" }, { status: 403 });
    }
    // No draft slips for teachers
    const fullRun = await prisma.payrollRun.findUnique({ where: { id: item.payrollRunId } });
    if (fullRun?.status === "DRAFT") {
      return NextResponse.json({ error: "Slip gaji belum tersedia" }, { status: 403 });
    }
  } else if (hasPermission(session, "payroll.view")) {
    // Admin or custom role with payroll.view: must belong to same tenant.
    // SUPER_ADMIN passes via the hasPermission short-circuit; SCHOOL_ADMIN
    // (default perms lack payroll.view) does not.
    if (item.payrollRun.tenantId !== session.tenantId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else {
    // SCHOOL_ADMIN (without payroll grant), GUARDIAN, or any other role:
    // no access to other employees' salary PDFs.
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: item.payrollRun.tenantId } });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://talib.annisaasekolahku.com";
  const data: SlipData = {
    schoolName: tenant?.name ?? "School",
    logoUrl: `${appUrl}/logo.png`,
    period: formatPeriodRange(item.payrollRun.periodStart, item.payrollRun.periodEnd),
    employeeName: item.employee.formalName ?? item.employee.nama,
    employeeCode: item.employee.kode,
    position: item.employee.jabatan,
    workingDays: item.payrollRun.actualWorkDays,
    bankName: item.employee.bankName,
    // Mask before passing into the PDF — defense-in-depth so the raw account
    // number never enters the rendered PDF bytes (UAT 2026-05-12 teacher
    // MAJOR — bank account unmasked on profile and PDF).
    bankAccountNo: item.employee.bankAccountNo ? maskBankAccount(item.employee.bankAccountNo) : null,
    incomeLines: item.lines
      .filter((l) => l.categorySnapshot === "INCOME")
      .map((l) => ({ label: l.labelSnapshot, amount: Number(l.finalAmount) })),
    deductionLines: item.lines
      .filter((l) => l.categorySnapshot === "DEDUCTION")
      .map((l) => ({ label: l.labelSnapshot, amount: Number(l.finalAmount) })),
    totalIncome: Number(item.grossAmount),
    totalDeductions: Number(item.deductions),
    netPay: Number(item.netAmount),
    generatedDate: new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(React.createElement(SalarySlipPdf, { data }) as any);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="slip-gaji-${item.employee.kode}.pdf"`,
      // Payroll PDFs contain salary + (now masked) bank info — keep them out
      // of shared caches (intermediaries, browser disk cache).
      "Cache-Control": "private, no-store",
    },
  });
}
