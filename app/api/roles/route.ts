import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { escalationForbidden, permissionsActorLacks } from "@/lib/security/role-escalation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { ALL_PERMISSIONS, hasPermission } from "@/lib/permissions";
import { validateBody } from "@/lib/api/validate";
import { createRoleSchema } from "@/lib/validations/role";

// Cache roles for 1 hour (static data)
export const revalidate = 3600;

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roles = await prisma.role.findMany({
    where: { tenantId: session.tenantId },
    include: { _count: { select: { users: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ data: roles });
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-role:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const result = await validateBody(createRoleSchema, body);
  if (result.error) return result.error;
  const { name, code, description } = result.data;

  // Check code uniqueness per tenant
  const existing = await prisma.role.findUnique({
    where: { tenantId_code: { tenantId: session.tenantId, code } },
  });
  if (existing) {
    return NextResponse.json({ error: "Kode peran sudah digunakan" }, { status: 409 });
  }

  // Validate permissions array
  const permissions: string[] = Array.isArray(body.permissions) ? body.permissions : [];
  const invalidPerms = permissions.filter((p: string) => !ALL_PERMISSIONS.includes(p));
  if (invalidPerms.length > 0) {
    return NextResponse.json(
      { error: `Izin tidak valid: ${invalidPerms.join(", ")}` },
      { status: 400 }
    );
  }

  // HR-1: never hand out a permission the actor does not hold themselves.
  const missing = permissionsActorLacks(session, permissions);
  if (missing.length > 0) return escalationForbidden(missing);

  const role = await prisma.role.create({
    data: {
      tenantId: session.tenantId,
      name,
      code,
      description: description?.trim() || null,
      isSystem: false,
      permissions: JSON.stringify(permissions),
    },
  });

  return NextResponse.json(role, { status: 201 });
}
