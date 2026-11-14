import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, invalidateUserCache, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  enumRolePermissions,
  escalationForbidden,
  parseRolePermissions,
  permissionsActorLacks,
} from "@/lib/security/role-escalation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { updateUserSchema } from "@/lib/validations/user";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      customRole: { select: { id: true, name: true, code: true } },
      employee: { select: { id: true, nama: true, jabatan: true } },
    },
  });

  if (!user || user.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`update-user:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "users.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Verify tenant ownership
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await validateBody(updateUserSchema, await req.json());
  if (result.error) return result.error;
  const { customRoleId, status } = result.data;

  // HR-1: privilege-escalation guards. SUPER_ADMIN (owner) is unrestricted.
  const actorIsSuper = session.role === "SUPER_ADMIN";
  if (!actorIsSuper) {
    if (existing.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Akun Super Admin tidak bisa diubah oleh Admin Sekolah" },
        { status: 403 },
      );
    }
    if (id === session.id) {
      const roleChanges = customRoleId !== undefined && (customRoleId || null) !== existing.customRoleId;
      const statusChanges = status !== undefined && status !== existing.status;
      if (roleChanges || statusChanges) {
        return NextResponse.json(
          { error: "Anda tidak bisa mengubah peran atau status akun Anda sendiri" },
          { status: 403 },
        );
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};

  // Assign custom role. An unchanged value is a no-op (the edit dialog always
  // resubmits both fields), so it neither needs nor triggers the grant check.
  if (customRoleId !== undefined && (customRoleId || null) !== existing.customRoleId) {
    if (customRoleId) {
      // Verify role belongs to tenant
      const role = await prisma.role.findUnique({ where: { id: customRoleId } });
      if (!role || role.tenantId !== session.tenantId) {
        return NextResponse.json({ error: "Peran tidak ditemukan" }, { status: 400 });
      }
      const missing = permissionsActorLacks(session, parseRolePermissions(role.permissions));
      if (missing.length > 0) return escalationForbidden(missing);
      data.customRoleId = customRoleId;
    } else {
      // Clearing falls back to the target's enum-role defaults — still a grant.
      const missing = permissionsActorLacks(session, enumRolePermissions(existing.role));
      if (missing.length > 0) return escalationForbidden(missing);
      data.customRoleId = null;
    }
  }

  // Update status
  if (status !== undefined) {
    // Prevent deactivating self
    if (status === "INACTIVE" && id === session.id) {
      return NextResponse.json({ error: "Tidak bisa menonaktifkan akun sendiri" }, { status: 400 });
    }
    data.status = status;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    include: {
      customRole: { select: { id: true, name: true, code: true } },
    },
  });

  // Role/status changes must bite on the next request, not after the TTL.
  invalidateUserCache(existing.email, user.email);

  return NextResponse.json(user);
}
