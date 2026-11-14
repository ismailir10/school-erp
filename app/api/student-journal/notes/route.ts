import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { noteBodySchema } from "@/lib/validations/student-journal";
import { requireNoteAccessForStudent } from "@/lib/student-journal/guards";
import { enrichNotesWithAuthorMetadata } from "@/lib/student-journal/note-metadata";
import {
  countUnreadNotes,
  DEFAULT_NOTE_PAGE_SIZE,
  MAX_NOTE_PAGE_SIZE,
} from "@/lib/student-journal/note-reads";

/**
 * GET /api/student-journal/notes?studentId=&cursor=&limit=
 *
 * The note thread for one student, newest first, **independent of any week**.
 *
 * Both note surfaces used to read notes out of the week payload, which filters
 * to the five days on screen — so a catatan became unreachable the Monday after
 * it was written unless the reader guessed its date and paged back to it. The
 * checklist is a week artifact; the conversation is not.
 *
 * Cursor is a note id, not an offset: notes arrive while a reader is scrolling,
 * and an offset would duplicate or skip a row every time one did. Ordering is
 * `createdAt desc, id desc` so same-millisecond notes still have a total order.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json({ error: "studentId wajib diisi" }, { status: 400 });
  }

  const access = await requireNoteAccessForStudent(studentId);
  if (access.error) return access.error;
  const { session, studentTenantId } = access;

  const limitParam = Number(searchParams.get("limit") ?? DEFAULT_NOTE_PAGE_SIZE);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), MAX_NOTE_PAGE_SIZE)
      : DEFAULT_NOTE_PAGE_SIZE;
  const cursor = searchParams.get("cursor");

  // take limit + 1: the extra row is the "is there another page" probe and is
  // never returned to the client.
  const rows = await prisma.studentJournalNote.findMany({
    where: {
      tenantId: studentTenantId,
      studentId,
      status: JournalStatus.ACTIVE,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      date: true,
      authorRole: true,
      authorUserId: true,
      body: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const [notes, unreadCount] = await Promise.all([
    enrichNotesWithAuthorMetadata(studentTenantId, page),
    countUnreadNotes({
      tenantId: studentTenantId,
      studentId,
      readerUserId: session.id,
    }),
  ]);

  return NextResponse.json({
    data: {
      notes,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      unreadCount,
    },
  });
}

export async function POST(req: NextRequest) {
  // Rate limit: 20 notes per minute per IP
  const ip = getClientIp(req);
  const rl = rateLimit(`sj-note-post:${ip}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  // Auth
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }

  const { studentId, date, body: noteBody } = parsed.data;

  // Authorization + the student's own tenantId in one call. The note's
  // tenantId is the STUDENT's, not the author's: otherwise a teacher in tenant
  // A writing on a student in tenant B (a guru pengganti) saves the note tagged
  // to A, and the guardian in B never sees it — the bug that surfaced as
  // "catatan visible on /parent/attendance but missing on /parent/student-journal".
  const access = await requireNoteAccessForStudent(studentId, true);
  if (access.error) return access.error;
  const noteTenantId = access.studentTenantId;

  // Create note + audit row in one transaction
  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.studentJournalNote.create({
      data: {
        tenantId: noteTenantId,
        studentId,
        date,
        authorUserId: session.id,
        authorRole: session.role,
        body: noteBody,
      },
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
        tenantId: noteTenantId,
        entityType: "NOTE",
        entityId: created.id,
        action: "CREATE",
        afterJson: {
          date: created.date,
          authorRole: created.authorRole,
          body: created.body,
          createdAt: created.createdAt.toISOString(),
        },
        changedByUserId: session.id,
      },
    });

    return created;
  });

  return NextResponse.json({ data: note }, { status: 201 });
}
