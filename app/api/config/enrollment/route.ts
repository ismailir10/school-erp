import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { enrollmentConfigSchema } from "@/lib/validations/enrollment-config";
import { getRequiredDocuments, normalizeRequiredDocuments } from "@/lib/enrollment/required-documents";

/**
 * GET/PUT /api/config/enrollment — which Kelengkapan Berkas documents a parent
 * must upload before the pendaftaran form can be submitted. One column on
 * Tenant (`enrollmentRequiredDocuments`); tenant always comes from the session.
 * GET needs `admissions.view`, PUT needs `admissions.edit`. It lives on Tenant,
 * not OrgConfig: creating an OrgConfig row here would flip attendance, payroll
 * and class working-day behaviour for tenants that never configured work hours.
 */

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requiredDocuments = await getRequiredDocuments(session.tenantId);
  return NextResponse.json({ requiredDocuments, canEdit: hasPermission(session, "admissions.edit") });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const { success } = rateLimit(`update-enrollment-config:${session.id}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }

  const parsed = enrollmentConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data tidak valid" }, { status: 400 });
  }
  const requiredDocuments = normalizeRequiredDocuments(parsed.data.requiredDocuments);

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { enrollmentRequiredDocuments: requiredDocuments },
    select: { enrollmentRequiredDocuments: true },
  });

  return NextResponse.json({ requiredDocuments: normalizeRequiredDocuments(tenant.enrollmentRequiredDocuments) });
}
