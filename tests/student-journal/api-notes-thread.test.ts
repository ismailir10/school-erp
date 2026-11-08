import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Cycle B — the note thread is week-independent, paged, and carries an unread
 * count. Route: GET /api/student-journal/notes, POST /api/student-journal/notes/read.
 */

const mocks = vi.hoisted(() => ({
  studentFindUnique: vi.fn(),
  studentFindFirst: vi.fn(),
  enrollmentFindMany: vi.fn(),
  assignmentFindFirst: vi.fn(),
  noteFindMany: vi.fn(),
  noteCount: vi.fn(),
  readFindUnique: vi.fn(),
  readFindMany: vi.fn(),
  readUpsert: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findUnique: mocks.studentFindUnique, findFirst: mocks.studentFindFirst },
    studentEnrollment: { findMany: mocks.enrollmentFindMany },
    teachingAssignment: { findFirst: mocks.assignmentFindFirst },
    sentraRotationClass: { findFirst: vi.fn().mockResolvedValue(null) },
    studentJournalNote: { findMany: mocks.noteFindMany, count: mocks.noteCount },
    studentJournalNoteRead: {
      findUnique: mocks.readFindUnique,
      findMany: mocks.readFindMany,
      upsert: mocks.readUpsert,
    },
    user: { findMany: mocks.userFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from "@/lib/auth";
import { GET } from "@/app/api/student-journal/notes/route";
import { POST as MARK_READ } from "@/app/api/student-journal/notes/read/route";

const buildReq = (url: string, body?: unknown): NextRequest =>
  ({
    url,
    headers: new Headers(),
    json: async () => body,
  }) as unknown as NextRequest;

const teacherSession = {
  id: "teacher-1",
  email: "t@t",
  name: "Bu Guru",
  role: "TEACHER",
  tenantId: "tenant-1",
  employeeId: "emp-1",
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

function note(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    date: "2026-07-14",
    authorRole: "GUARDIAN",
    authorUserId: "wali-1",
    body: `catatan ${id}`,
    createdAt: new Date("2026-07-14T01:00:00Z"),
    updatedAt: new Date("2026-07-14T01:00:00Z"),
    ...overrides,
  };
}

describe("GET /api/student-journal/notes — week-independent thread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(teacherSession as never);
    mocks.studentFindUnique.mockResolvedValue({ tenantId: "tenant-1" });
    mocks.enrollmentFindMany.mockResolvedValue([{ classSectionId: "class-1" }]);
    mocks.assignmentFindFirst.mockResolvedValue({ id: "assign-1" });
    mocks.userFindMany.mockResolvedValue([
      { id: "wali-1", name: "Ibu Nurul", role: "GUARDIAN" },
    ]);
    mocks.readFindUnique.mockResolvedValue(null);
  });

  it("rejects a request with no studentId before touching the database", async () => {
    const res = await GET(buildReq("http://localhost/api/student-journal/notes"));
    expect(res.status).toBe(400);
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
  });

  it("returns notes with no week filter at all, newest first", async () => {
    mocks.noteFindMany.mockResolvedValue([note("n1"), note("n2")]);

    const res = await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();

    const where = mocks.noteFindMany.mock.calls[0][0].where;
    expect(where.date).toBeUndefined();
    expect(where).toMatchObject({ tenantId: "tenant-1", studentId: "stu-1" });
    expect(mocks.noteFindMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(json.data.notes.map((n: { id: string }) => n.id)).toEqual(["n1", "n2"]);
    expect(json.data.notes[0].authorName).toBe("Ibu Nurul");
  });

  it("pages by note id and hides the look-ahead row", async () => {
    // limit=2 → route asks for 3; the third proves another page exists.
    mocks.noteFindMany.mockResolvedValue([note("n1"), note("n2"), note("n3")]);

    const res = await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1&limit=2"),
    );
    const json = await res.json();

    expect(mocks.noteFindMany.mock.calls[0][0].take).toBe(3);
    expect(json.data.notes).toHaveLength(2);
    expect(json.data.nextCursor).toBe("n2");
  });

  it("returns a null cursor on the last page", async () => {
    mocks.noteFindMany.mockResolvedValue([note("n1")]);

    const res = await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1&limit=2"),
    );
    expect((await res.json()).data.nextCursor).toBeNull();
  });

  it("walks from a cursor, skipping the cursor row itself", async () => {
    mocks.noteFindMany.mockResolvedValue([note("n3")]);

    await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1&cursor=n2"),
    );

    const args = mocks.noteFindMany.mock.calls[0][0];
    expect(args.cursor).toEqual({ id: "n2" });
    expect(args.skip).toBe(1);
  });

  it("caps an oversized limit rather than trusting the caller", async () => {
    mocks.noteFindMany.mockResolvedValue([]);

    await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1&limit=5000"),
    );
    expect(mocks.noteFindMany.mock.calls[0][0].take).toBe(51); // MAX 50 + look-ahead
  });

  it("counts every other-party note as unread when the reader has no watermark yet (X-3)", async () => {
    mocks.noteFindMany.mockResolvedValue([note("n1")]);
    mocks.readFindUnique.mockResolvedValue(null);
    mocks.noteCount.mockResolvedValue(1);

    const res = await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1"),
    );
    expect((await res.json()).data.unreadCount).toBe(1);
    const where = mocks.noteCount.mock.calls[0][0].where;
    expect(where).toMatchObject({ authorUserId: { not: "teacher-1" } });
    expect(where).not.toHaveProperty("createdAt");
  });

  it("counts only other people's notes written after the watermark", async () => {
    mocks.noteFindMany.mockResolvedValue([note("n1")]);
    mocks.readFindUnique.mockResolvedValue({
      lastReadAt: new Date("2026-07-10T00:00:00Z"),
    });
    mocks.noteCount.mockResolvedValue(2);

    const res = await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1"),
    );
    expect((await res.json()).data.unreadCount).toBe(2);
    expect(mocks.noteCount.mock.calls[0][0].where).toMatchObject({
      authorUserId: { not: "teacher-1" },
      createdAt: { gt: new Date("2026-07-10T00:00:00Z") },
      status: "ACTIVE",
    });
  });

  it("403s a teacher who is not assigned to any of the student's classes", async () => {
    mocks.assignmentFindFirst.mockResolvedValue(null);

    const res = await GET(
      buildReq("http://localhost/api/student-journal/notes?studentId=stu-1"),
    );
    expect(res.status).toBe(403);
    expect(mocks.noteFindMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/student-journal/notes/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(teacherSession as never);
    mocks.studentFindUnique.mockResolvedValue({ tenantId: "tenant-1" });
    mocks.enrollmentFindMany.mockResolvedValue([{ classSectionId: "class-1" }]);
    mocks.assignmentFindFirst.mockResolvedValue({ id: "assign-1" });
    mocks.readUpsert.mockResolvedValue({ lastReadAt: new Date("2026-08-26T02:00:00Z") });
  });

  it("upserts one watermark row keyed by reader + student", async () => {
    const res = await MARK_READ(
      buildReq("http://localhost/api/student-journal/notes/read", {
        studentId: "stu-1",
      }),
    );

    expect(res.status).toBe(200);
    const args = mocks.readUpsert.mock.calls[0][0];
    expect(args.where).toEqual({
      userId_studentId: { userId: "teacher-1", studentId: "stu-1" },
    });
    expect(args.create).toMatchObject({
      tenantId: "tenant-1",
      userId: "teacher-1",
      studentId: "stu-1",
    });
    expect((await res.json()).data.lastReadAt).toBe("2026-08-26T02:00:00.000Z");
  });

  it("rejects a body with no studentId", async () => {
    const res = await MARK_READ(
      buildReq("http://localhost/api/student-journal/notes/read", {}),
    );
    expect(res.status).toBe(400);
    expect(mocks.readUpsert).not.toHaveBeenCalled();
  });

  it("refuses to mark a student the caller cannot see", async () => {
    mocks.assignmentFindFirst.mockResolvedValue(null);

    const res = await MARK_READ(
      buildReq("http://localhost/api/student-journal/notes/read", {
        studentId: "stu-1",
      }),
    );
    expect(res.status).toBe(403);
    expect(mocks.readUpsert).not.toHaveBeenCalled();
  });
});
