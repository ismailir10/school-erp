import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, invalidateUserCache, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { ALL_PERMISSIONS, hasPermission } from "@/lib/permissions";
import {
  escalationForbidden,
  parseRolePermissions,
  permissionsActorLacks,
} from "@/lib/security/role-escalation";
import { validateBody } from "@/lib/api/validate";
import { updateRoleSchema } from "@/lib/validations/role";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const role = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });

  if (!role || role.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(role);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`update-role:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.isSystem) {
    return NextResponse.json({ error: "Peran bawaan tidak bisa diedit" }, { status: 403 });
  }

  // HR-1: a non-SUPER_ADMIN may only edit a role whose permissions — before
  // and after the edit — all sit inside their own. This also covers the role
  // currently assigned to the actor (they cannot widen their own grant).
  const held = permissionsActorLacks(session, parseRolePermissions(existing.permissions));
  if (held.length > 0) {
    return NextResponse.json(
      { error: `Anda tidak bisa mengubah peran yang memuat izin di luar izin Anda: ${held.join(", ")}`, missing: held },
      { status: 403 },
    );
  }

  const body = await req.json();
  const result = await validateBody(updateRoleSchema, body);
  if (result.error) return result.error;
  const { name, description } = result.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};

  if (name?.trim()) data.name = name.trim();
  if (description !== undefined) data.description = description?.trim() || null;

  if (Array.isArray(body.permissions)) {
    const invalidPerms = body.permissions.filter((p: string) => !ALL_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      return NextResponse.json(
        { error: `Izin tidak valid: ${invalidPerms.join(", ")}` },
        { status: 400 }
      );
    }
    const missing = permissionsActorLacks(session, body.permissions);
    if (missing.length > 0) return escalationForbidden(missing);
    data.permissions = JSON.stringify(body.permissions);
  }

  const role = await prisma.role.update({
    where: { id },
    data,
  });

  // Holders of this role must see the new permission set on their next
  // request, not after the session cache TTL.
  if (data.permissions !== undefined) {
    const holders = await prisma.user.findMany({
      where: { customRoleId: id },
      select: { email: true },
    });
    invalidateUserCache(...holders.map((u) => u.email));
  }

  return NextResponse.json(role);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`delete-role:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.role.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.isSystem) {
    return NextResponse.json({ error: "Peran bawaan tidak bisa dihapus" }, { status: 403 });
  }

  if (existing._count.users > 0) {
    return NextResponse.json(
      { error: `Peran masih digunakan oleh ${existing._count.users} pengguna` },
      { status: 409 }
    );
  }

  // Intentional hard delete — Role has no status field (config entity)
  await prisma.role.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
