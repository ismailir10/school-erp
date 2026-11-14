import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { updateIndicatorSchema } from "@/lib/validations/student-journal";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success } = rateLimit(`sj-indicators-put:${getClientIp(req)}`, 60, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const guard = await requireAdmin("students.edit");
  if (guard.error) return guard.error;
  const { session } = guard;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = updateIndicatorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }

  const existing = await prisma.studentJournalIndicator.findUnique({
    where: { id },
    include: { category: { include: { template: true } } },
  });
  if (!existing || existing.category.template.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Reject categoryId change that crosses tenants.
  if (parsed.data.categoryId && parsed.data.categoryId !== existing.categoryId) {
    const newCat = await prisma.studentJournalCategory.findUnique({
      where: { id: parsed.data.categoryId },
      include: { template: true },
    });
    if (!newCat || newCat.template.tenantId !== session.tenantId) {
      return NextResponse.json({ error: "Kategori tujuan tidak valid" }, { status: 404 });
    }
  }

  const updated = await prisma.studentJournalIndicator.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ data: updated });
}
