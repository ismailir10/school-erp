import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Buku Penghubung access for a guru sentra: a teacher with NO TeachingAssignment
 * but a sentra in a putaran containing the class is let in; a teacher with
 * neither is still 403. The real lib/sentra/access helpers run on mocked prisma.
 */
const m = vi.hoisted(() => ({
  assignmentFindFirst: vi.fn(),
  assignmentFindMany: vi.fn(),
  sentraClassFindFirst: vi.fn(),
  sentraRotationFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  studentFindUnique: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  // Anything the routes touch after the guard resolves to an empty result.
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, fn: string) => {
          if (name === "teachingAssignment" && fn === "findFirst") return m.assignmentFindFirst;
          if (name === "teachingAssignment" && fn === "findMany") return m.assignmentFindMany;
          if (name === "sentraRotationClass" && fn === "findFirst") return m.sentraClassFindFirst;
          if (name === "sentraRotation" && fn === "findMany") return m.sentraRotationFindMany;
          if (name === "studentEnrollment" && fn === "findMany") return m.enrollmentFindMany;
          if (name === "student" && fn === "findUnique") return m.studentFindUnique;
          return vi.fn().mockResolvedValue(/^(find(Many|All)|groupBy)$/.test(fn) ? [] : null);
        },
      },
    );
  const prisma = new Proxy(
    {},
    {
      get: (_t, name: string) =>
        name === "$transaction" ? vi.fn().mockResolvedValue(null) : model(name),
    },
  );
  return { prisma };
});
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  getSession: m.getSession,
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { GET as classGrid } from "@/app/api/student-journal/class-grid/route";
import { POST as batch } from "@/app/api/student-journal/entries/batch/route";
import { GET as week } from "@/app/api/student-journal/students/[id]/week/route";
import { requireNoteAccessForStudent } from "@/lib/student-journal/guards";

const teacher = { id: "u1", role: "TEACHER", tenantId: "t1", employeeId: "e1" };

function gridReq() {
  return new NextRequest("http://localhost/api/student-journal/class-grid?classSectionId=c1&date=2026-11-04");
}
function batchReq() {
  return new NextRequest("http://localhost/api/student-journal/entries/batch", {
    method: "POST",
    body: JSON.stringify({ classSectionId: "c1", date: "2026-11-04", entries: [] }),
  });
}
const weekCtx = { params: Promise.resolve({ id: "s1" }) };
const weekReq = () => new NextRequest("http://localhost/api/student-journal/students/s1/week");

beforeEach(() => {
  vi.clearAllMocks();
  m.getSession.mockResolvedValue(teacher);
  m.assignmentFindFirst.mockResolvedValue(null);
  m.assignmentFindMany.mockResolvedValue([]);
  m.sentraClassFindFirst.mockResolvedValue(null);
  m.sentraRotationFindMany.mockResolvedValue([]);
  m.enrollmentFindMany.mockResolvedValue([
    { classSectionId: "c1", classSection: { name: "TK A 3" }, student: { id: "s1", name: "Ani", nickname: null } },
  ]);
  m.studentFindUnique.mockResolvedValue({ tenantId: "t1" });
});

describe("class-grid GET", () => {
  it("allows a guru sentra with no assignment", async () => {
    m.sentraClassFindFirst.mockResolvedValue({ id: "src1" });
    expect((await classGrid(gridReq())).status).toBe(200);
    expect(m.sentraClassFindFirst).toHaveBeenCalled();
  });
  it("403s when neither assignment nor sentra matches", async () => {
    expect((await classGrid(gridReq())).status).toBe(403);
  });
});

describe("entries/batch POST", () => {
  it("allows a guru sentra with no assignment", async () => {
    m.sentraClassFindFirst.mockResolvedValue({ id: "src1" });
    expect((await batch(batchReq())).status).not.toBe(403);
  });
  it("403s when neither assignment nor sentra matches", async () => {
    expect((await batch(batchReq())).status).toBe(403);
  });
});

describe("requireNoteAccessForStudent (teacher)", () => {
  it("allows via sentra", async () => {
    m.sentraClassFindFirst.mockResolvedValue({ id: "src1" });
    const r = await requireNoteAccessForStudent("s1");
    expect(r.error).toBeUndefined();
  });
  it("403s an outsider", async () => {
    const r = await requireNoteAccessForStudent("s1");
    expect(r.error?.status).toBe(403);
  });
});

describe("student week GET", () => {
  it("allows via sentra", async () => {
    m.sentraClassFindFirst.mockResolvedValue({ id: "src1" });
    expect((await week(weekReq(), weekCtx)).status).not.toBe(403);
  });
  it("403s an outsider", async () => {
    expect((await week(weekReq(), weekCtx)).status).toBe(403);
  });
});

// Attendance and the teacher student list share requireTeacherForClass but stay
// assignment-only (cycle non-goal): without `viaSentra` the sentra path is never
// consulted, even when it would say yes.
describe("requireTeacherForClass without viaSentra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getSession.mockResolvedValue(teacher);
    m.assignmentFindFirst.mockResolvedValue(null);
    m.sentraClassFindFirst.mockResolvedValue({ id: "rc1" });
  });

  it("403s a guru sentra and never queries sentra", async () => {
    const { requireTeacherForClass } = await import("@/lib/student-journal/guards");
    const res = await requireTeacherForClass("c1");
    expect(res.error?.status).toBe(403);
    expect(m.sentraClassFindFirst).not.toHaveBeenCalled();
  });

  it("lets the same guru sentra in when the caller opts in", async () => {
    const { requireTeacherForClass } = await import("@/lib/student-journal/guards");
    const res = await requireTeacherForClass("c1", { viaSentra: true });
    expect(res.error).toBeUndefined();
  });
});
