import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { adjustPayrollLineSchema } from "@/lib/validations/payroll";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; lineId: string }> }
) {
  const auth = await requirePermission("payroll.create");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id: payrollRunId, lineId, itemId } = await params;

  // #9 fix: check payroll status — only DRAFT can be edited
  const payrollRun = await prisma.payrollRun.findUnique({ where: { id: payrollRunId } });
  if (!payrollRun || payrollRun.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (payrollRun.status !== "DRAFT") {
    return NextResponse.json({ error: "Hanya draf yang bisa diedit" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const result = await validateBody(adjustPayrollLineSchema, body);
  if (result.error) return result.error;
  const { adjustmentAmount, adjustmentNote } = result.data;

  // Ownership chain: the tenant check above covers only the run — the item must
  // belong to that run and the line to that item, or mismatched ids could write
  // into another run's (or tenant's) payroll.
  const item = await prisma.payrollItem.findUnique({ where: { id: itemId } });
  if (!item || item.payrollRunId !== payrollRunId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const line = await prisma.payrollItemLine.findUnique({ where: { id: lineId } });
  if (!line || line.payrollItemId !== itemId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Money stays in Decimal end-to-end — no float arithmetic on amounts.
  const adjustmentDec = new Prisma.Decimal(adjustmentAmount.toString());
  const finalAmount = new Prisma.Decimal(line.calculatedAmount.toString()).plus(adjustmentDec);

  // HRX-4: an adjustment may reduce a component to zero but never below it
  // (-400.000 on a 300.000 allowance used to store a -100.000 line).
  if (finalAmount.isNegative()) {
    const message = "Penyesuaian membuat komponen bernilai negatif.";
    return NextResponse.json(
      { error: message, errors: [{ field: "adjustmentAmount", message }] },
      { status: 400 },
    );
  }

  // Update line + recalculate item totals atomically
  await prisma.$transaction(async (tx) => {
    await tx.payrollItemLine.update({
      where: { id: lineId },
      data: {
        adjustmentAmount: adjustmentDec,
        adjustmentNote,
        finalAmount,
      },
    });

    const allLines = await tx.payrollItemLine.findMany({ where: { payrollItemId: itemId } });
    const zero = new Prisma.Decimal(0);
    const gross = allLines
      .filter((l) => l.categorySnapshot === "INCOME")
      .reduce((s, l) => s.plus(new Prisma.Decimal(l.finalAmount.toString())), zero);
    const ded = allLines
      .filter((l) => l.categorySnapshot === "DEDUCTION")
      .reduce((s, l) => s.plus(new Prisma.Decimal(l.finalAmount.toString())), zero);

    await tx.payrollItem.update({
      where: { id: itemId },
      data: { grossAmount: gross, deductions: ded, netAmount: gross.minus(ded) },
    });
  });

  return NextResponse.json({ ok: true });
}
