import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, academicYearFindFirst, loadPenilaianMonitor } =
  vi.hoisted(() => ({
    requirePermission: vi.fn(),
    academicYearFindFirst: vi.fn(),
    loadPenilaianMonitor: vi.fn(),
  }));

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({
  prisma: { academicYear: { findFirst: academicYearFindFirst } },
}));
vi.mock("@/lib/curriculum/penilaian-monitor", () => ({ loadPenilaianMonitor }));

import { GET } from "@/app/api/admin/assessments/route";

const ALLOW = { session: { tenantId: "tenant_x", role: "SCHOOL_ADMIN" } };

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/assessments", () => {
  it("propagates the auth guard's error (deny)", async () => {
    requirePermission.mockResolvedValue({
      error: Response.json({ error: "forbidden", missing: "assessments.read" }, { status: 403 }),
    });
    const res = await GET(req("http://t/api/admin/assessments"));
    expect(res.status).toBe(403);
    expect(loadPenilaianMonitor).not.toHaveBeenCalled();
  });

  it("403 for GUARDIAN/TEACHER who hold assessments.read for their own children/classes", async () => {
    for (const role of ["GUARDIAN", "TEACHER"]) {
      requirePermission.mockResolvedValue({ session: { tenantId: "tenant_x", role } });
      const res = await GET(req("http://t/api/admin/assessments"));
      expect(res.status).toBe(403);
    }
    expect(academicYearFindFirst).not.toHaveBeenCalled();
    expect(loadPenilaianMonitor).not.toHaveBeenCalled();
  });

  it("400 on malformed date param", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    const res = await GET(req("http://t/api/admin/assessments?week=2026-13-99x"));
    expect(res.status).toBe(400);
    expect(academicYearFindFirst).not.toHaveBeenCalled();
  });

  it("422 when no active academic year", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    academicYearFindFirst.mockResolvedValue(null);
    const res = await GET(req("http://t/api/admin/assessments?week=2026-08-03&day=2026-08-03"));
    expect(res.status).toBe(422);
    expect(loadPenilaianMonitor).not.toHaveBeenCalled();
  });

  it("200 with monitor payload on the happy path", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    academicYearFindFirst.mockResolvedValue({ id: "ay1", name: "2026/2027" });
    loadPenilaianMonitor.mockResolvedValue({
      week: { id: "w1", number: 3, subThemeName: "Aku Sehat", themeName: "Saya Anak Sehat" },
      walas: [{ classSectionId: "c1", className: "TK A1", programName: "TKIT", enrolled: 2, assessed: 1 }],
      sentra: [{ center: "WORSHIP", entries: 1, studentsAssessed: 1 }],
    });

    const res = await GET(req("http://t/api/admin/assessments?week=2026-08-03&day=2026-08-03"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.academicYear).toBe("2026/2027");
    expect(body.data.weekDate).toBe("2026-08-03");
    expect(body.data.sentraDate).toBe("2026-08-03");
    expect(body.data.walas[0].assessed).toBe(1);
    expect(loadPenilaianMonitor).toHaveBeenCalledWith(
      "tenant_x",
      "ay1",
      new Date("2026-08-03T00:00:00Z"),
      new Date("2026-08-03T00:00:00Z"),
    );
  });

  it("defaults week+day to today when params absent", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    academicYearFindFirst.mockResolvedValue({ id: "ay1", name: "2026/2027" });
    loadPenilaianMonitor.mockResolvedValue({ week: null, walas: [], sentra: [] });
    const res = await GET(req("http://t/api/admin/assessments"));
    expect(res.status).toBe(200);
    expect(loadPenilaianMonitor).toHaveBeenCalledTimes(1);
  });
});
