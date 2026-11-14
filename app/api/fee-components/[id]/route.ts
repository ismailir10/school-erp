import { NextRequest, NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { updateFeeComponentSchema } from "@/lib/validations/fee-component";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "fees.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  // Verify tenant ownership
  const existing = await prisma.feeComponentDef.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!existing) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const parsed = updateFeeComponentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Partial update — Prisma omits undefined keys, so the enable/disable toggle
  // (body = { isEnabled }) touches only that column, and a full edit updates
  // label/category/flags. `label` is already trimmed by the schema.
  const { label, category, isRecurring, isEnabled, sortOrder } = parsed.data;
  const c = await prisma.feeComponentDef.update({
    where: { id },
    data: { label, category, isRecurring, isEnabled, sortOrder },
  });
  return NextResponse.json(c);
}
