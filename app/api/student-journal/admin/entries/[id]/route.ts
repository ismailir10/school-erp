import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { adminEntryUpdateSchema } from "@/lib/validations/student-journal";

/**
 * PUT /api/student-journal/admin/entries/[id]
 *
 * Admin update of a single journal entry.
 * Runs as a transaction: updates the entry + writes an audit row atomically.
 * V1: only updates existing entries — if the row doesn't exist the caller
 * should not hit this endpoint (the UI shows an info toast instead).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin("students.edit");
  if (guard.error) return guard.error;
  const { session } = guard;

  // Rate limit: 60 edits/minute per IP
  const ip = getClientIp(req);
  const rl = rateLimit(`sj-admin-entry-put:${ip}`, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const { id } = await params;

  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = adminEntryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }

  // Fetch existing entry
  const existing = await prisma.studentJournalEntry.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      checked: true,
    },
  });

  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Entri tidak ditemukan" }, { status: 404 });
  }

  // Transactional update + audit
  const [updated] = await prisma.$transaction([
    prisma.studentJournalEntry.update({
      where: { id },
      data: {
        checked: parsed.data.checked,
        recordedByUserId: session.id,
      },
      select: {
        id: true,
        indicatorId: true,
        date: true,
        scope: true,
        checked: true,
        recordedByUserId: true,
        updatedAt: true,
      },
    }),
    prisma.studentJournalAudit.create({
      data: {
        tenantId: session.tenantId,
        entityType: "ENTRY",
        entityId: id,
        action: "UPDATE",
        beforeJson: { checked: existing.checked },
        afterJson: { checked: parsed.data.checked },
        changedByUserId: session.id,
      },
    }),
  ]);

  return NextResponse.json({ data: updated });
}
