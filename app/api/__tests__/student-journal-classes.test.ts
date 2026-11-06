import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  assignments: vi.fn(),
  classes: vi.fn(),
  sentraIds: vi.fn(),
  today: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    teachingAssignment: { findMany: m.assignments },
    classSection: { findMany: m.classes },
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: m.getSession }));
vi.mock("@/lib/sentra/access", () => ({
  getSentraClassIds: m.sentraIds,
  getTeacherSentraToday: m.today,
}));

import { GET } from "../student-journal/classes/route";

const teacher = { id: "u", role: "TEACHER", tenantId: "t1", employeeId: "e1" };
const cls = (id: string, name: string) => ({
  id,
  name,
  status: "ACTIVE",
  academicYear: { status: "ACTIVE" },
  program: { name: "TK" },
});
const call = (qs = "") => GET(new NextRequest(`http://localhost/api/student-journal/classes${qs}`));

beforeEach(() => {
  vi.resetAllMocks();
  m.getSession.mockResolvedValue(teacher);
  m.assignments.mockResolvedValue([]);
  m.classes.mockResolvedValue([]);
  m.sentraIds.mockResolvedValue([]);
  m.today.mockResolvedValue([]);
});

describe("GET /api/student-journal/classes", () => {
  it("401 without a session, 403 for non-teachers", async () => {
    m.getSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    m.getSession.mockResolvedValue({ ...teacher, role: "GUARDIAN" });
    expect((await call()).status).toBe(403);
  });

  it("400 on a malformed date", async () => {
    expect((await call("?date=04-11-2026")).status).toBe(400);
  });

  it("orders today's sentra class, then assigned, then other sentra classes", async () => {
    m.assignments.mockResolvedValue([
      { role: "HOMEROOM", classSection: cls("a", "TK A 3") },
      { role: "ASSISTANT", classSection: cls("b", "TK A 1") },
    ]);
    m.sentraIds.mockResolvedValue(["c", "d", "a"]);
    m.classes.mockResolvedValue([cls("c", "TK B 4"), cls("d", "TK B 3")]);
    m.today.mockResolvedValue([{ classSectionId: "d", sentraName: "Balok" }]);
    const res = await call("?date=2026-11-04");
    const body = await res.json();
    expect(body.map((i: { id: string }) => i.id)).toEqual(["d", "b", "a", "c"]);
    expect(body[0]).toMatchObject({ access: "SENTRA", todaySentraName: "Balok" });
    expect(body[1]).toMatchObject({ access: "ASSIGNED", role: "ASSISTANT" });
    expect(m.today).toHaveBeenCalledWith("e1", "t1", "2026-11-04");
    // dedup: "a" is both assigned and in the sentra list, not re-fetched
    expect(m.classes.mock.calls[0][0].where.id.in).toEqual(["c", "d"]);
    expect(m.classes.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("an assigned class that is also today's sentra stays ASSIGNED with the sentra name", async () => {
    m.assignments.mockResolvedValue([{ role: "HOMEROOM", classSection: cls("a", "TK A 3") }]);
    m.sentraIds.mockResolvedValue(["a"]);
    m.today.mockResolvedValue([{ classSectionId: "a", sentraName: "Seni" }]);
    const body = await (await call("?date=2026-11-04")).json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ access: "ASSIGNED", todaySentraName: "Seni" });
  });
});
