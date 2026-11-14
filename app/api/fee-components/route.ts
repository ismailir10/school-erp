import { NextRequest, NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { fieldErrorResponse, isUniqueViolation } from "@/lib/api/field-errors";
import { createFeeComponentSchema } from "@/lib/validations/fee-component";

// Cache fee components for 1 hour (static data)
export const revalidate = 3600;

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  // HR-16: fee catalog is only used by admin finance screens.
  if (!isAdminRole(session.role) || !(hasPermission(session, "fees.view") || hasPermission(session, "invoices.view") || hasPermission(session, "invoices.create"))) return NextResponse.json([], { status: 403 });

  const components = await prisma.feeComponentDef.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(components);
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-fee-component:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "fees.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  }
  const parsed = await validateBody(createFeeComponentSchema, rawBody);
  if (parsed.error) return parsed.error;
  const { code, label, category, isRecurring, sortOrder } = parsed.data;

  try {
    const component = await prisma.feeComponentDef.create({
      data: { tenantId: session.tenantId, code, label, category, isRecurring, sortOrder },
    });
    return NextResponse.json(component, { status: 201 });
  } catch (error) {
    // @@unique([tenantId, code]) — a reused code was an unhandled 500 with an
    // empty body and a bare "Gagal" in the dialog (FIN-3). Report it on Kode.
    if (isUniqueViolation(error)) {
      return fieldErrorResponse("code", "Kode komponen sudah dipakai");
    }
    throw error;
  }
}
