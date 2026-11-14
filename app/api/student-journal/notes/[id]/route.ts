import { NextRequest, NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { getSession, isAdminRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { noteUpdateSchema } from "@/lib/validations/student-journal";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isAdminRole(session.role) && (!hasPermission(session, "students.view") || !hasPermission(session, "students.edit"))) return NextResponse.json({ error: "Akses mengubah catatan tidak tersedia. Hubungi admin sekolah." }, { status: 403 });

  const rl = rateLimit(`sj-note-put:${getClientIp(req)}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = noteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }

  // Find existing note
  const existing = await prisma.studentJournalNote.findUnique({
    where: { id },
    select: { id: true, tenantId: true, authorUserId: true, body: true },
  });

  // Return 404 if missing OR cross-tenant
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Catatan tidak ditemukan" }, { status: 404 });
  }

  // Only author can edit
  if (existing.authorUserId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Update + audit row in one transaction
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.studentJournalNote.update({
      where: { id },
      data: { body: parsed.data.body },
      select: {
        id: true,
        date: true,
        authorRole: true,
        body: true,
        createdAt: true,
      },
    });

    await tx.studentJournalAudit.create({
      data: {
        tenantId: existing.tenantId,
        entityType: "NOTE",
        entityId: id,
        action: "UPDATE",
        beforeJson: { body: existing.body },
        afterJson: { body: result.body },
        changedByUserId: session.id,
      },
    });

    return result;
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isAdminRole(session.role) && (!hasPermission(session, "students.view") || !hasPermission(session, "students.edit"))) return NextResponse.json({ error: "Akses mengubah catatan tidak tersedia. Hubungi admin sekolah." }, { status: 403 });

  const rl = rateLimit(`sj-note-delete:${getClientIp(req)}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const existing = await prisma.studentJournalNote.findUnique({
    where: { id },
    select: { id: true, tenantId: true, authorUserId: true, status: true },
  });

  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Catatan tidak ditemukan" }, { status: 404 });
  }

  if (existing.authorUserId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft-delete via status flag — standardized to "INACTIVE" to match admin path + schema default enum.
  // Transactional soft-delete + audit row.
  await prisma.$transaction(async (tx) => {
    await tx.studentJournalNote.update({
      where: { id },
      data: { status: "INACTIVE" },
    });

    await tx.studentJournalAudit.create({
      data: {
        tenantId: existing.tenantId,
        entityType: "NOTE",
        entityId: id,
        action: "DELETE",
        beforeJson: { status: existing.status },
        changedByUserId: session.id,
      },
    });
  });

  return NextResponse.json({ data: { id } });
}
