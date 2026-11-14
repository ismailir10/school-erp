import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAdminHeaderContext } from "@/lib/admin/header-context-tag";
import { getSession, isAdminRole } from "@/lib/auth";
import { verifyTenantOwnership } from "@/lib/auth-guard";
import { validateBody } from "@/lib/api/validate";
import { updateCampusSchema } from "@/lib/validations/campus";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "settings.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await verifyTenantOwnership("campus", id, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await validateBody(updateCampusSchema, await req.json().catch(() => null));
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const campus = await prisma.campus.update({
    where: { id },
    data: {
      name: body.name?.trim(),
      // Only keys present in the body are written: `PUT { status: "ACTIVE" }`
      // (Reaktivasi) used to null address/lat/lng. Explicit null / blank
      // still clears (the edit dialog sends null for a blanked field).
      address: body.address === undefined ? undefined : body.address?.trim() || null,
      lat: body.lat,
      lng: body.lng,
      radiusMeters: body.radiusMeters,
      status: body.status,
    },
  });

  invalidateAdminHeaderContext();
  return NextResponse.json(campus);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "settings.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await verifyTenantOwnership("campus", id, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Block deactivation if employees still reference this campus — guards
  // against orphaned campusId on Employee. Pattern matches class-sections.
  const empCount = await prisma.employee.count({ where: { campusId: id } });
  if (empCount > 0) {
    return NextResponse.json(
      { error: `Tidak bisa dinonaktifkan: ${empCount} karyawan masih ditugaskan` },
      { status: 400 }
    );
  }

  // Soft delete per CRUD Standard Category A — Campus is foundational
  // reference data; FK history (ClassSection.campusId) must remain intact.
  // Reactivate via PUT { status: "ACTIVE" }.
  await prisma.campus.update({
    where: { id },
    data: { status: "INACTIVE" },
  });
  invalidateAdminHeaderContext();
  return NextResponse.json({ ok: true });
}
