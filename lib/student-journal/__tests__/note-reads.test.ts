import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  studentJournalNoteRead: { findMany: vi.fn(), findUnique: vi.fn() },
  studentJournalNote: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { countUnreadNotes, countUnreadNotesByStudent } from "../note-reads";

beforeEach(() => vi.resetAllMocks());

const d = (iso: string) => new Date(iso);

describe("countUnreadNotesByStudent", () => {
  it("counts in the database with each child's exact watermark and eligibility filters", async () => {
    const first = d("2026-09-23T00:00:00Z");
    const second = d("2026-09-24T00:00:00Z");
    db.studentJournalNoteRead.findMany.mockResolvedValue([
      { studentId: "a", lastReadAt: first },
      { studentId: "b", lastReadAt: second },
    ]);
    db.studentJournalNote.groupBy.mockResolvedValue([
      { studentId: "a", _count: { _all: 1500 } },
      { studentId: "b", _count: { _all: 1 } },
    ]);

    expect(await countUnreadNotesByStudent({
      tenantId: "tenant", studentIds: ["a", "b"], readerUserId: "teacher", authorRole: "GUARDIAN",
    })).toEqual({ a: 1500, b: 1 });
    expect(db.studentJournalNoteRead.findMany).toHaveBeenCalledWith({
      where: { userId: "teacher", studentId: { in: ["a", "b"] } },
      select: { studentId: true, lastReadAt: true },
    });
    expect(db.studentJournalNote.groupBy).toHaveBeenCalledExactlyOnceWith({
      by: ["studentId"],
      where: {
        tenantId: "tenant",
        status: "ACTIVE",
        authorRole: "GUARDIAN",
        authorUserId: { not: "teacher" },
        // Strictly newer: equality is already read, and b must not use a's older cutoff.
        OR: [
          { studentId: "a", createdAt: { gt: first } },
          { studentId: "b", createdAt: { gt: second } },
        ],
      },
      _count: { _all: true },
    });
    expect(db.studentJournalNote.findMany).not.toHaveBeenCalled();
  });

  it("counts all history on never-opened threads without a timestamp restriction (X-3)", async () => {
    db.studentJournalNoteRead.findMany.mockResolvedValue([]);
    db.studentJournalNote.groupBy.mockResolvedValue([{ studentId: "a", _count: { _all: 12 } }]);

    expect(await countUnreadNotesByStudent({
      tenantId: "tenant", studentIds: ["a"], readerUserId: "teacher", authorRole: "GUARDIAN",
    })).toEqual({ a: 12 });
    expect(db.studentJournalNote.groupBy.mock.calls[0][0].where.OR).toEqual([
      { studentId: { in: ["a"] } },
    ]);
  });

  it("mixes opened and never-opened threads without restricting the optional author role", async () => {
    const readAt = d("2026-09-24T00:00:00Z");
    db.studentJournalNoteRead.findMany.mockResolvedValue([{ studentId: "opened", lastReadAt: readAt }]);
    db.studentJournalNote.groupBy.mockResolvedValue([
      { studentId: "fresh", _count: { _all: 2 } },
      { studentId: "opened", _count: { _all: 1 } },
    ]);

    expect(await countUnreadNotesByStudent({
      tenantId: "tenant", studentIds: ["fresh", "opened"], readerUserId: "parent",
    })).toEqual({ fresh: 2, opened: 1 });
    const { where } = db.studentJournalNote.groupBy.mock.calls[0][0];
    expect(where.OR).toEqual([
      { studentId: { in: ["fresh"] } },
      { studentId: "opened", createdAt: { gt: readAt } },
    ]);
    expect(where).not.toHaveProperty("authorRole");
  });

  it("omits students with no unread notes and does not multiply counts for duplicate input IDs", async () => {
    db.studentJournalNoteRead.findMany.mockResolvedValue([]);
    db.studentJournalNote.groupBy.mockResolvedValue([{ studentId: "a", _count: { _all: 2 } }]);

    expect(await countUnreadNotesByStudent({
      tenantId: "tenant", studentIds: ["a", "a", "quiet"], readerUserId: "parent",
    })).toEqual({ a: 2 });
    expect(db.studentJournalNote.groupBy).toHaveBeenCalledTimes(1);
  });

  it("returns an empty map when all requested threads are read", async () => {
    db.studentJournalNoteRead.findMany.mockResolvedValue([
      { studentId: "a", lastReadAt: d("2026-09-24T00:00:00Z") },
    ]);
    db.studentJournalNote.groupBy.mockResolvedValue([]);
    expect(await countUnreadNotesByStudent({
      tenantId: "tenant", studentIds: ["a"], readerUserId: "parent",
    })).toEqual({});
  });

  it("returns an empty map without querying for an empty roster", async () => {
    expect(await countUnreadNotesByStudent({
      tenantId: "tenant", studentIds: [], readerUserId: "teacher",
    })).toEqual({});
    expect(db.studentJournalNoteRead.findMany).not.toHaveBeenCalled();
    expect(db.studentJournalNote.groupBy).not.toHaveBeenCalled();
  });

  it("propagates lookup errors so callers can distinguish unavailable counts from zero", async () => {
    const failure = new Error("database unavailable");
    db.studentJournalNoteRead.findMany.mockRejectedValueOnce(failure);
    const args = { tenantId: "tenant", studentIds: ["a"], readerUserId: "teacher" };
    await expect(countUnreadNotesByStudent(args)).rejects.toBe(failure);
    expect(db.studentJournalNote.groupBy).not.toHaveBeenCalled();

    db.studentJournalNoteRead.findMany.mockResolvedValue([]);
    db.studentJournalNote.groupBy.mockRejectedValue(failure);
    await expect(countUnreadNotesByStudent(args)).rejects.toBe(failure);
  });
});

describe("countUnreadNotes", () => {
  it("with no read row counts all of the other party's active notes (no createdAt bound)", async () => {
    db.studentJournalNoteRead.findUnique.mockResolvedValue(null);
    db.studentJournalNote.count.mockResolvedValue(3);

    expect(await countUnreadNotes({ tenantId: "t", studentId: "s", readerUserId: "parent" })).toBe(3);
    const where = db.studentJournalNote.count.mock.calls[0]![0].where;
    expect(where).toMatchObject({ tenantId: "t", studentId: "s", authorUserId: { not: "parent" } });
    expect(where).not.toHaveProperty("createdAt");
  });

  it("with a read row only counts notes after the watermark", async () => {
    const readAt = d("2026-09-24T00:00:00Z");
    db.studentJournalNoteRead.findUnique.mockResolvedValue({ lastReadAt: readAt });
    db.studentJournalNote.count.mockResolvedValue(1);

    expect(await countUnreadNotes({ tenantId: "t", studentId: "s", readerUserId: "parent" })).toBe(1);
    expect(db.studentJournalNote.count.mock.calls[0]![0].where).toMatchObject({
      createdAt: { gt: readAt },
    });
  });
});
