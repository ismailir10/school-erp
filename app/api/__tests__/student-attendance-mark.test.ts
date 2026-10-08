import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  prisma: {
    teachingAssignment: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    student: { findMany: vi.fn() },
    studentAttendance: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

function makeSession(
  role: SessionUser["role"],
  employeeId: string | null = null
): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role,
    tenantId: "t1",
    employeeId,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/student-attendance/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  classSectionId: "cs-1",
  date: "2026-04-20",
  records: [{ studentId: "s-1", status: "PRESENT" }],
};

describe("POST /api/student-attendance/mark — role + Zod + tenant-scoped assignment", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/lib/db");
    // Default: every requested student is ACTIVE-enrolled (checked pre-tx).
    vi.mocked(prisma.studentEnrollment.findMany).mockImplementation((async (args: { where: { studentId: { in: string[] } } }) =>
      args.where.studentId.in.map((studentId) => ({ studentId }))) as never);
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
  });

  it("returns 401 when no session", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(null as never);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 for GUARDIAN", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("GUARDIAN"));
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when `status` is not one of the enum values (Zod)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(
      makeReq({
        ...validBody,
        records: [{ studentId: "s-1", status: "GHOSTED" }],
      }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/validasi/i);
  });

  it("returns 403 when TEACHER is not assigned to the class (tenant-scoped lookup)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
    vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue(null);

    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(403);

    // Verify the lookup included the tenant filter.
    expect(prisma.teachingAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: "emp-1",
        classSectionId: "cs-1",
        classSection: { tenantId: "t1" },
      },
    });
  });

  it("proceeds for TEACHER assigned to the class, no ClassSession that day → legacy sessionId:null path", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
    vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue({ id: "ta-1" } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        // No ClassSession row for this date → falls back to the legacy
        // sessionId:null upsert (findFirst + create/update) after the
        // @@unique([studentId, date]) drop (cycle 2026-05-15
        // academic-hierarchy-refactor).
        classSession: { findMany: vi.fn().mockResolvedValue([]) },
        studentAttendance: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
          upsert: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(1);
  });

  it("proceeds for TEACHER assigned to the class, exactly one ClassSession that day → writes into that session's row (pilot-readiness-audit T2: prevents double-count vs the session-based flow)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
    vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue({ id: "ta-1" } as never);
    const upsert = vi.fn().mockResolvedValue({});
    const legacyFindFirst = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        classSession: { findMany: vi.fn().mockResolvedValue([{ id: "sess-1" }]) },
        studentAttendance: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: legacyFindFirst,
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
          upsert,
        },
      };
      return cb(tx);
    });

    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(1);
    // Wrote into the session's unique row, not the sessionId:null legacy path.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId_sessionId: { studentId: "s-1", sessionId: "sess-1" } },
      })
    );
    expect(legacyFindFirst).not.toHaveBeenCalled();
  });
});

it("scopes legacy updates to the selected class and reports a cross-class legacy collision",async()=>{
 const {getSession}=await import("@/lib/auth");const {prisma}=await import("@/lib/db");
 vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER","emp-1"));vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue({id:"ta"} as never);
 vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([{studentId:"s-1"}] as never);
 const findFirst=vi.fn().mockResolvedValue(null), create=vi.fn().mockRejectedValue({code:"P2002"}), update=vi.fn();
 vi.mocked(prisma.$transaction).mockImplementation((async (cb:(tx:unknown)=>unknown)=>cb({$executeRaw:vi.fn().mockResolvedValue(1),classSession:{findMany:vi.fn().mockResolvedValue([])},studentAttendance:{findFirst,create,update}})) as never);
 const {POST}=await import("../student-attendance/mark/route");const result=await POST(makeReq(validBody) as never);
 expect(findFirst).toHaveBeenCalledWith({where:{studentId:"s-1",classSectionId:"cs-1",date:validBody.date,sessionId:null},select:{id:true,status:true}});
 expect(result.status).toBe(409);expect((await result.json()).error).toContain("kelas lain");expect(update).not.toHaveBeenCalled();
});

// --- api-integrity T5 (STR-9 / STR-10 / STR-12 / STR-14) ---------------------

type Existing = { id: string; status: string } | null;

/** Wires a TEACHER session and a tx whose sessionId:null path sees `existing`. */
async function setupLegacyPath(existing: Existing = null) {
  const { getSession } = await import("@/lib/auth");
  const { prisma } = await import("@/lib/db");
  vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
  vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue({ id: "ta-1" } as never);
  vi.mocked(prisma.studentEnrollment.findMany).mockImplementation((async (args: { where: { studentId: { in: string[] } } }) =>
    args.where.studentId.in.map((studentId) => ({ studentId }))) as never);
  const order: string[] = [];
  const executeRaw = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    order.push(`lock:${String(values[0])}`);
    return 1;
  });
  const update = vi.fn(async () => {
    order.push("write");
    return {};
  });
  const create = vi.fn(async () => {
    order.push("write");
    return {};
  });
  const findFirst = vi.fn().mockResolvedValue(existing);
  vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
    cb({
      $executeRaw: executeRaw,
      classSession: { findMany: vi.fn().mockResolvedValue([]) },
      studentAttendance: { findFirst, create, update },
    })) as never);
  return { executeRaw, update, create, findFirst, order, prisma };
}

describe("POST /api/student-attendance/mark — integrity (api-integrity T5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("STR-9: takes a per-student advisory lock inside the tx before each find, in sorted studentId order", async () => {
    const { executeRaw, order } = await setupLegacyPath(null);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(
      makeReq({
        ...validBody,
        records: [
          { studentId: "s-c", status: "SICK" },
          { studentId: "s-a", status: "SICK" },
          { studentId: "s-b", status: "SICK" },
        ],
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(executeRaw).toHaveBeenCalledTimes(3);
    expect(executeRaw.mock.calls.map((c) => c.slice(1))).toEqual([
      ["s-a", "2026-04-20"],
      ["s-b", "2026-04-20"],
      ["s-c", "2026-04-20"],
    ]);
    // Lock, then write, per student — never a write ahead of its own lock.
    expect(order).toEqual(["lock:s-a", "write", "lock:s-b", "write", "lock:s-c", "write"]);
    expect(String(executeRaw.mock.calls[0][0].join("?"))).toContain("pg_advisory_xact_lock");
  });

  it("STR-9: rejects a non-calendar date (2026-02-30) with 400", async () => {
    await setupLegacyPath(null);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq({ ...validBody, date: "2026-02-30" }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Tanggal tidak valid");
  });

  it("STR-9: rejects a date older than 400 days with 400", async () => {
    const { prisma } = await setupLegacyPath(null);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq({ ...validBody, date: "2019-01-01" }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Tanggal terlalu lama untuk diubah.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("STR-12: a student not ACTIVE-enrolled → 422 student_not_enrolled with the name, never a 500, no tx opened", async () => {
    const { prisma } = await setupLegacyPath(null);
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.student.findMany).mockResolvedValue([{ id: "s-1", name: "Budi" }] as never);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("student_not_enrolled");
    expect(body.message).toBe("Siswa tidak terdaftar di kelas ini: Budi");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("STR-12: falls back to the id when the student name cannot be resolved", async () => {
    const { prisma } = await setupLegacyPath(null);
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("s-1");
  });

  it("STR-14: status changes and no notes sent → notes cleared (null)", async () => {
    const { update } = await setupLegacyPath({ id: "att-1", status: "ABSENT" });
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(
      makeReq({ ...validBody, records: [{ studentId: "s-1", status: "SICK" }] }) as never,
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SICK", notes: null }) }),
    );
  });

  it("STR-14: status unchanged and no notes sent → existing notes kept (notes undefined)", async () => {
    const { update } = await setupLegacyPath({ id: "att-1", status: "SICK" });
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(
      makeReq({ ...validBody, records: [{ studentId: "s-1", status: "SICK" }] }) as never,
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notes: undefined }) }),
    );
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notes: null }) }),
    );
  });

  it("STR-14: notes sent with a status change → the new notes win", async () => {
    const { update } = await setupLegacyPath({ id: "att-1", status: "ABSENT" });
    const { POST } = await import("../student-attendance/mark/route");
    await POST(
      makeReq({ ...validBody, records: [{ studentId: "s-1", status: "SICK", notes: "demam" }] }) as never,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notes: "demam" }) }),
    );
  });

  it("STR-14: single-session path clears notes on a status change too", async () => {
    const { prisma } = await setupLegacyPath(null);
    const upsert = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
      cb({
        $executeRaw: vi.fn(),
        classSession: { findMany: vi.fn().mockResolvedValue([{ id: "sess-1" }]) },
        studentAttendance: {
          findUnique: vi.fn().mockResolvedValue({ status: "ABSENT" }),
          upsert,
        },
      })) as never);
    const { POST } = await import("../student-attendance/mark/route");
    const res = await POST(
      makeReq({ ...validBody, records: [{ studentId: "s-1", status: "SICK" }] }) as never,
    );
    expect(res.status).toBe(200);
    expect(upsert.mock.calls[0][0].update.notes).toBeNull();
  });
  it.each(["SICK", "PERMISSION", "ABSENT"])(
    "R2-T-4: %s clears checkInTime/checkOutTime on the legacy update path, even if times are sent",
    async (status) => {
      const { update } = await setupLegacyPath({ id: "att-1", status: "PRESENT" });
      const { POST } = await import("../student-attendance/mark/route");
      const res = await POST(
        makeReq({
          ...validBody,
          records: [{ studentId: "s-1", status, checkInTime: "2026-04-20T00:42:00.000Z" }],
        }) as never,
      );
      expect(res.status).toBe(200);
      const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
      expect(data.checkInTime).toBeNull();
      expect(data.checkOutTime).toBeNull();
    },
  );

  it("R2-T-4: PRESENT without times leaves existing times alone (undefined)", async () => {
    const { update } = await setupLegacyPath({ id: "att-1", status: "SICK" });
    const { POST } = await import("../student-attendance/mark/route");
    await POST(makeReq(validBody) as never);
    const data = (update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.checkInTime).toBeUndefined();
    expect(data.checkOutTime).toBeUndefined();
  });

  it("R2-T-4: single-session path nulls times on SICK in both create and update", async () => {
    const { prisma } = await setupLegacyPath(null);
    const upsert = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
      cb({
        $executeRaw: vi.fn(),
        classSession: { findMany: vi.fn().mockResolvedValue([{ id: "sess-1" }]) },
        studentAttendance: {
          findUnique: vi.fn().mockResolvedValue({ status: "PRESENT" }),
          upsert,
        },
      })) as never);
    const { POST } = await import("../student-attendance/mark/route");
    await POST(makeReq({ ...validBody, records: [{ studentId: "s-1", status: "SICK" }] }) as never);
    const arg = upsert.mock.calls[0][0];
    expect(arg.update.checkInTime).toBeNull();
    expect(arg.update.checkOutTime).toBeNull();
    expect(arg.create.checkInTime).toBeNull();
    expect(arg.create.checkOutTime).toBeNull();
  });
});
