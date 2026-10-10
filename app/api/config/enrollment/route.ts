import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { enrollmentConfigSchema } from "@/lib/validations/enrollment-config";
import { getRequiredDocuments, normalizeRequiredDocuments } from "@/lib/enrollment/required-documents";
import { getProgramFees } from "@/lib/enrollment/fee-config";

/**
 * GET/PUT /api/config/enrollment — pendaftaran settings: which Kelengkapan
 * Berkas documents a parent must upload before the form can be submitted (one
 * column on Tenant, `enrollmentRequiredDocuments`), and each program's
 * pendaftaran fee (`Program.enrollmentFee`, 0 = no payment step). Tenant always
 * comes from the session. GET needs `admissions.view`, PUT needs
 * `admissions.edit`. The documents live on Tenant, not OrgConfig: creating an
 * OrgConfig row here would flip attendance, payroll and class working-day
 * behaviour for tenants that never configured work hours.
 */

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [requiredDocuments, programs] = await Promise.all([
    getRequiredDocuments(session.tenantId),
    getProgramFees(session.tenantId),
  ]);
  return NextResponse.json({
    requiredDocuments,
    programs,
    canEdit: hasPermission(session, "admissions.edit"),
  });
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

  const result = await validateBody(enrollmentConfigSchema, body);
  if (result.error) return result.error;
  const requiredDocuments = normalizeRequiredDocuments(result.data.requiredDocuments);
  const programFees = result.data.programFees;

  const updateTenant = () =>
    prisma.tenant.update({
      where: { id: tenantId },
      data: { enrollmentRequiredDocuments: requiredDocuments },
      select: { enrollmentRequiredDocuments: true },
    });

  let stored: unknown;
  if (programFees === undefined) {
    // Documents-only client: fees stay exactly as they are.
    stored = (await updateTenant()).enrollmentRequiredDocuments;
  } else {
    // Every id must be an ACTIVE program of THIS tenant, or a caller could
    // price (or probe the existence of) another school's program.
    const ids = programFees.map((r) => r.programId);
    const owned = ids.length
      ? await prisma.program.findMany({
          where: { id: { in: ids }, tenantId, status: "ACTIVE" },
          select: { id: true },
        })
      : [];
    if (owned.length !== ids.length) {
      // Also what a program deactivated since the page loaded looks like, so say
      // what to do: a plain retry of the same body can never succeed.
      return NextResponse.json({ error: "Daftar program berubah. Muat ulang halaman lalu coba lagi." }, { status: 422 });
    }
    const [tenant] = await prisma.$transaction([
      updateTenant(),
      ...programFees.map((r) =>
        prisma.program.updateMany({ where: { id: r.programId, tenantId }, data: { enrollmentFee: r.fee } }),
      ),
    ]);
    stored = tenant.enrollmentRequiredDocuments;
  }

  return NextResponse.json({
    requiredDocuments: normalizeRequiredDocuments(stored),
    programs: await getProgramFees(tenantId),
  });
}
