import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * DELETE /api/student-journal/admin/notes/[id]
 *
 * Admin soft-delete of a journal note.
 * Sets status = "INACTIVE" and writes an audit row in one transaction.
 * Hard deletes are never performed — see CLAUDE.md soft-delete standard.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin("students.edit");
  if (guard.error) return guard.error;
  const { session } = guard;

  // Rate limit: 30 deletes/minute per IP
  const ip = getClientIp(req);
  const rl = rateLimit(`sj-admin-note-delete:${ip}`, 30, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const { id } = await params;

  // Fetch existing note
  const existing = await prisma.studentJournalNote.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      status: true,
    },
  });

  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Catatan tidak ditemukan" }, { status: 404 });
  }

  // Transactional soft-delete + audit
  await prisma.$transaction([
    prisma.studentJournalNote.update({
      where: { id },
      data: { status: "INACTIVE" },
    }),
    prisma.studentJournalAudit.create({
      data: {
        tenantId: session.tenantId,
        entityType: "NOTE",
        entityId: id,
        action: "DELETE",
        beforeJson: { status: existing.status },
        afterJson: { status: "INACTIVE" },
        changedByUserId: session.id,
      },
    }),
  ]);

  return NextResponse.json({ data: { ok: true } });
}
