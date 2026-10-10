import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, getSession, recordAudit } = vi.hoisted(() => ({
  db: {
    student: { findFirst: vi.fn(), update: vi.fn() },
    studentEnrollment: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  getSession: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/auth", () => ({
  getSession,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: "s1" }) };
function req(body: unknown = {}) {
  return new Request("http://t/api/students/s1/graduate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["students.edit"] });
});

describe("POST /api/students/[id]/graduate", () => {
  it("400 in plain Indonesian (no 'enrollment' loanword) when the student has no active class (CORE-13)", async () => {
    db.student.findFirst.mockResolvedValue({ id: "s1", status: "ACTIVE" });
    db.studentEnrollment.findMany.mockResolvedValue([]);

    const res = await POST(req(), params);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Siswa belum terdaftar di kelas aktif.");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("writes no audit row when the student already graduated", async () => {
    db.student.findFirst.mockResolvedValue({ id: "s1", status: "GRADUATED" });

    const res = await POST(req(), params);

    expect(res.status).toBe(400);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("graduates a student with an active enrollment", async () => {
    db.student.findFirst.mockResolvedValue({ id: "s1", status: "ACTIVE" });
    db.studentEnrollment.findMany.mockResolvedValue([{ id: "e1" }]);
    const tx = {
      student: { update: vi.fn().mockResolvedValue({ id: "s1", status: "GRADUATED" }) },
      studentEnrollment: { updateMany: vi.fn() },
    };
    db.$transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));

    const res = await POST(req({ graduationDate: "2026-06-20" }), params);

    expect(res.status).toBe(200);
    expect(tx.student.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "GRADUATED", graduationDate: "2026-06-20" },
    });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t1",
        actorId: "u1",
        entity: "Student",
        entityId: "s1",
        action: "graduate",
        after: { graduationDate: "2026-06-20" },
      },
      tx,
    );
  });
});
