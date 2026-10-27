import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx, session } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    classSection: { findFirst: vi.fn(), updateMany: vi.fn() },
    program: { findFirst: vi.fn() },
    studentEnrollment: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    invoice: { findMany: vi.fn() }, billingRunRow: { findMany: vi.fn() },
  };
  const db = {
    student: { findFirst: vi.fn() }, classSection: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    program: { findFirst: vi.fn() }, studentEnrollment: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { db, tx, session: { id: "u1", tenantId: "t1", role: "SUPER_ADMIN", permissions: [] } };
});
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (original) => ({ ...await original<typeof import("@/lib/auth")>(), getSession: vi.fn(async () => session) }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: vi.fn(async () => ({ session })) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/classes/year-guard", () => ({ ensureYearWritableForClass: vi.fn(async () => ({ ok: true })), ensureYearWritableById: vi.fn(async () => ({ ok: true })) }));

import { POST as studentEnroll } from "../students/[id]/enroll/route";
import { POST as classEnroll } from "../admin/classes/[id]/enrollments/route";
import { POST as promote } from "../students/[id]/promote/route";
import { POST as bulkPromote } from "../promotions/route";
import { PATCH as changeProgram } from "../admin/classes/[id]/route";

const section = { id: "c1", academicYearId: "y1", programId: "p1", program: { id: "p1", type: "SEMESTER", name: "School", ageMin: null, ageMax: null }, academicYear: { startDate: "2026-07-01" }, capacity: 20, name: "School A" };
const req = (body: unknown) => new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (cb) => cb(tx));
  db.student.findFirst.mockResolvedValue({ id: "s1", tenantId: "t1", status: "ACTIVE", dateOfBirth: null });
  db.classSection.findFirst.mockResolvedValue(section);
  tx.classSection.findFirst.mockResolvedValue(section);
  db.classSection.findFirstOrThrow.mockResolvedValue(section);
  db.program.findFirst.mockResolvedValue({ id: "p2", type: "YEAR_ROUND" });
  tx.program.findFirst.mockResolvedValue({ id: "p2", type: "YEAR_ROUND" });
  tx.studentEnrollment.count.mockResolvedValue(0);
  tx.studentEnrollment.findMany.mockResolvedValue([]);
  tx.studentEnrollment.create.mockResolvedValue({ id: "new" });
  tx.studentEnrollment.upsert.mockResolvedValue({ id: "new" });
  tx.$queryRaw.mockResolvedValue([{ id: "c1", capacity: 20, active_count: 0 }]);
  tx.invoice.findMany.mockResolvedValue([]); tx.billingRunRow.findMany.mockResolvedValue([]);
  tx.classSection.updateMany.mockResolvedValue({ count: 1 });
});

describe("class program changes versus enrollment snapshots", () => {
  it.each([["student detail", studentEnroll, { classSectionId: "c1" }, "s1"], ["class detail", classEnroll, { studentId: "s1" }, "c1"]] as const)("%s refuses the old program snapshot after a class move", async (_, handler, body, id) => {
    tx.classSection.findFirst.mockResolvedValue({ ...section, programId: "p2", program: { ...section.program, id: "p2", type: "YEAR_ROUND" } });
    const res = await handler(req(body), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "CLASS_CHANGED_MEANWHILE" });
    expect(tx.studentEnrollment.create).not.toHaveBeenCalled();
    expect(tx.studentEnrollment.update).not.toHaveBeenCalled();
  });

  it("class move refuses a snapshot superseded by a different program change", async () => {
    tx.classSection.findFirst.mockResolvedValue({ ...section, programId: "p3", program: { ...section.program, id: "p3", type: "SESSION" } });
    const res = await changeProgram(req({ programId: "p2" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(409);
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
  });

  it("single promotion refuses a second active enrollment in the target stream/year", async () => {
    db.studentEnrollment.findFirst.mockResolvedValue({ id: "old", studentId: "s1", classSectionId: "old-class" });
    tx.studentEnrollment.findFirst.mockImplementation(async (args) => args.where.id ? { id: "other", classSectionId: "other-class", classSection: { name: "Already enrolled" } } : { id: "old", studentId: "s1", classSectionId: "old-class" });
    const res = await promote(req({ targetClassSectionId: "c1" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(409);
    expect(tx.studentEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("bulk promotion refuses a second active enrollment before graduating any source row", async () => {
    const source = [{ id: "old", studentId: "s1", classSectionId: "old-class" }];
    db.studentEnrollment.findMany.mockResolvedValue(source);
    tx.studentEnrollment.findMany.mockResolvedValue(source);
    tx.studentEnrollment.findFirst.mockResolvedValue({ id: "other", classSectionId: "other-class", classSection: { name: "Already enrolled" } });
    const res = await bulkPromote(req({ sourceClassSectionId: "old-class", targetClassSectionId: "c1" }));
    expect(res.status).toBe(409);
    expect(tx.studentEnrollment.updateMany).not.toHaveBeenCalled();
    expect(tx.studentEnrollment.upsert).not.toHaveBeenCalled();
  });
});
