import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { createIndicatorSchema } from "@/lib/validations/student-journal";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`sj-indicators-post:${getClientIp(req)}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const guard = await requireAdmin("students.edit");
  if (guard.error) return guard.error;
  const { session } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = createIndicatorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }

  // Tenant-check via category → template
  const category = await prisma.studentJournalCategory.findUnique({
    where: { id: parsed.data.categoryId },
    include: { template: true },
  });
  if (!category || category.template.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Kategori tidak ditemukan" }, { status: 404 });
  }

  const indicator = await prisma.studentJournalIndicator.create({
    data: {
      categoryId: parsed.data.categoryId,
      label: parsed.data.label,
      order: parsed.data.order,
    },
  });
  return NextResponse.json({ data: indicator }, { status: 201 });
}
