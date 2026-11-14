import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { updateCategorySchema } from "@/lib/validations/student-journal";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success } = rateLimit(`sj-categories-put:${getClientIp(req)}`, 40, 60_000);
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

  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }

  const existing = await prisma.studentJournalCategory.findUnique({
    where: { id },
    include: { template: true },
  });
  if (!existing || existing.template.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cascade-deactivate child indicators when category is deactivated. Reactivation
  // does NOT cascade — admin must reactivate indicators explicitly.
  const cascadeDeactivate = parsed.data.status === JournalStatus.INACTIVE;

  const updated = cascadeDeactivate
    ? await prisma.$transaction(async (tx) => {
        const cat = await tx.studentJournalCategory.update({
          where: { id },
          data: parsed.data,
        });
        await tx.studentJournalIndicator.updateMany({
          where: { categoryId: id, status: JournalStatus.ACTIVE },
          data: { status: JournalStatus.INACTIVE },
        });
        return cat;
      })
    : await prisma.studentJournalCategory.update({
        where: { id },
        data: parsed.data,
      });
  return NextResponse.json({ data: updated });
}
