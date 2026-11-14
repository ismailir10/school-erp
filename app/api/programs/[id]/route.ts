import { requirePermission } from "@/lib/auth-guards";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { updateProgramSchema } from "@/lib/validations/program";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { success } = rateLimit(`update-program:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await params;

  const existing = await prisma.program.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!existing) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const parsed = updateProgramSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const finalMin = body.ageMin === undefined ? existing.ageMin : body.ageMin;
  const finalMax = body.ageMax === undefined ? existing.ageMax : body.ageMax;
  if (finalMin != null && finalMax != null && finalMin > finalMax) {
    return NextResponse.json({ error: "Usia minimum tidak boleh melebihi usia maksimum", errors: [{ field: "ageMax", message: "Usia minimum tidak boleh melebihi usia maksimum" }] }, { status: 400 });
  }
  if (body.code && body.code !== existing.code) {
    const duplicate = await prisma.program.findFirst({ where: { tenantId: session.tenantId, code: body.code, id: { not: id } }, select: { id: true } });
    if (duplicate) return NextResponse.json({ error: "Kode program sudah digunakan", errors: [{ field: "code", message: "Kode program sudah digunakan" }] }, { status: 409 });
  }

  const program = await prisma.program.update({
    where: { id },
    data: {
      code: body.code,
      name: body.name?.trim(),
      // Key-present only: a status-only PUT (Nonaktifkan / Aktifkan kembali)
      // used to wipe the description. Explicit null / blank still clears.
      description: body.description === undefined ? undefined : body.description?.trim() || null,
      type: body.type,
      ageMin: body.ageMin,
      ageMax: body.ageMax,
      status: body.status,
    },
  });
  return NextResponse.json(program);
}
