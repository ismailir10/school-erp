import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  parentFindFirst,
  semesterFindFirst,
  assessmentEntryFindMany,
  weekFindFirst,
  studentEnrollmentFindMany,
} = vi.hoisted(() => ({
  parentFindFirst: vi.fn(),
  semesterFindFirst: vi.fn(),
  assessmentEntryFindMany: vi.fn(),
  weekFindFirst: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    parent: { findFirst: parentFindFirst },
    semester: { findFirst: semesterFindFirst },
    assessmentEntry: { findMany: assessmentEntryFindMany },
    week: { findFirst: weekFindFirst },
    studentEnrollment: { findMany: studentEnrollmentFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { GET } from "@/app/api/parent/perkembangan/[studentId]/route";
import { getSession } from "@/lib/auth";

const guardianSession = {
  id: "u1",
  email: "wali@demo.local",
  name: "Wali",
  role: "GUARDIAN" as const,
  tenantId: "t1",
  employeeId: null,
  parentId: "p1",
  permissions: ["students.view", "invoices.view", "assessments.read"],
  customRoleCode: null,
};

const parentWithOneChild = {
  id: "p1",
  guardians: [
    {
      relationship: "ORANGTUA",
      student: {
        id: "stu1",
        name: "Anak Satu",
        nickname: "A1",
        enrollments: [
          {
            id: "en1",
            status: "ACTIVE",
            classSection: {
              id: "cs1",
              name: "TKIT A",
              program: { name: "TKIT" },
            },
          },
        ],
      },
    },
  ],
};

function req(): Request {
  return new Request("http://localhost/api/parent/perkembangan/stu1");
}

beforeEach(() => {
  vi.clearAllMocks();
  studentEnrollmentFindMany.mockResolvedValue([
    { studentId: "stu1", classSection: { ageGroup: "A" } },
  ]);
});

describe("GET /api/parent/perkembangan/[studentId]", () => {
  it("401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 when caller is not GUARDIAN", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...guardianSession,
      role: "TEACHER",
      parentId: null,
    });
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu1" }),
    });
    expect(res.status).toBe(403);
  });

  it("403 when GUARDIAN lacks assessments.read", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...guardianSession,
      permissions: ["students.view"],
    });
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu1" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 when studentId doesn't belong to the guardian's parent", async () => {
    vi.mocked(getSession).mockResolvedValue(guardianSession);
    parentFindFirst.mockResolvedValue(parentWithOneChild);
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu-not-mine" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 with neutral copy (no studentId leak) when wrong child", async () => {
    vi.mocked(getSession).mockResolvedValue(guardianSession);
    parentFindFirst.mockResolvedValue(parentWithOneChild);
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu-not-mine" }),
    });
    const body = await res.json();
    expect(body.error).toBe("Anak tidak ditemukan.");
  });

  it("200 happy path — returns child + semester + element rollup", async () => {
    vi.mocked(getSession).mockResolvedValue(guardianSession);
    parentFindFirst.mockResolvedValue(parentWithOneChild);
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      academicYear: { id: "ay1", name: "2025/2026" },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([
      {
        level: "CONSISTENT",
        indicator: { content: "x", objective: { element: "RELIGIOUS_MORAL" } },
      },
    ]);
    weekFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.child.id).toBe("stu1");
    expect(body.child.name).toBe("Anak Satu");
    expect(body.semester.id).toBe("sem1");
    expect(body.elements).toHaveLength(5);
    const nam = body.elements.find(
      (e: { element: string }) => e.element === "RELIGIOUS_MORAL",
    );
    expect(nam.counts.CONSISTENT).toBe(1);
  });

  it("200 with hasActiveWeek=false when no active week", async () => {
    vi.mocked(getSession).mockResolvedValue(guardianSession);
    parentFindFirst.mockResolvedValue(parentWithOneChild);
    semesterFindFirst.mockResolvedValue({
      id: "sem1",
      number: 1,
      academicYear: { id: "ay1", name: "2025/2026" },
    });
    assessmentEntryFindMany.mockResolvedValueOnce([]);
    weekFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ studentId: "stu1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasActiveWeek).toBe(false);
    expect(body.latestThisWeek).toEqual([]);
  });
});
