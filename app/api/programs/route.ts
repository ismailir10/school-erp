import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth-guards";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { createProgramSchema } from "@/lib/validations/program";

// Cache programs for 1 hour (static data)
export const revalidate = 3600;

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  if (!["academic.view", "students.view", "invoices.view", "fees.view", "admissions.view", "curriculum.read"].some((permission) => hasPermission(session, permission))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const programs = await prisma.program.findMany({
    where: { tenantId: session.tenantId },
    include: { _count: { select: { classSections: true } } },
    orderBy: { code: "asc" },
  });
  return NextResponse.json(programs);
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-program:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const result = await validateBody(createProgramSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  const program = await prisma.program.create({
    data: {
      tenantId: session.tenantId,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      description: body.description?.trim() || null,
      type: body.type,
      ageMin: body.ageMin ?? null,
      ageMax: body.ageMax ?? null,
    },
  });
  return NextResponse.json(program, { status: 201 });
}
