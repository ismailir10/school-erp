import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSession, renderToBuffer, db } = vi.hoisted(() => ({
  getSession: vi.fn(),
  renderToBuffer: vi.fn(),
  db: {
    parent: { findFirst: vi.fn() },
    term: { findFirst: vi.fn() },
    student: { findFirst: vi.fn() },
    reportCardEntry: { findFirst: vi.fn() },
    studentMeasurement: { findFirst: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ getSession }));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer,
  StyleSheet: { create: (x: unknown) => x },
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { GET } from "@/app/api/guardian/report-cards/[studentId]/[termId]/pdf/route";

const GUARDIAN = { tenantId: "t1", parentId: "p1", email: "siti@x.com", role: "GUARDIAN" };
const ctx = { params: Promise.resolve({ studentId: "s1", termId: "term1" }) };
const TERM = {
  id: "term1",
  number: 1,
  startDate: new Date(),
  endDate: new Date(),
  semester: { number: 1, academicYear: { name: "2025/2026" } },
};
const ENTRY = {
  sectionLevels: { RELIGIOUS_MORAL: "CONSISTENT" },
  sectionNarratives: { RELIGIOUS_MORAL: "Berkembang baik" },
  sickDays: 1,
  permittedAbsenceDays: 0,
  unexcusedAbsenceDays: 2,
  totalSchoolDays: 60,
  memorizationNotes: "Al-Fatihah",
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/guardian/report-cards/[studentId]/[termId]/pdf", () => {
  it("403 when not a guardian session", async () => {
    getSession.mockResolvedValue({ tenantId: "t1", role: "SCHOOL_ADMIN" });
    expect((await GET({} as never, ctx)).status).toBe(403);
    expect(db.parent.findFirst).not.toHaveBeenCalled();
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    getSession.mockResolvedValue(null);
    expect((await GET({} as never, ctx)).status).toBe(401);
  });

  it("404 without querying when the session has neither parentId nor email (no null-email global match)", async () => {
    getSession.mockResolvedValue({ tenantId: "t1", parentId: null, email: null, role: "GUARDIAN" });
    expect((await GET({} as never, ctx)).status).toBe(404);
    // Critical: must NOT fall through to a `where: { email: null }` lookup.
    expect(db.parent.findFirst).not.toHaveBeenCalled();
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("falls back to email lookup only when email is a non-empty string", async () => {
    getSession.mockResolvedValue({ tenantId: "t1", parentId: null, email: "siti@x.com", role: "GUARDIAN" });
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "other" }] });
    await GET({} as never, ctx);
    const where = db.parent.findFirst.mock.calls[0]![0].where;
    expect(where).toEqual({ email: "siti@x.com", tenantId: "t1" });
  });

  it("only counts ACTIVE guardian links (an unlinked guardian loses access)", async () => {
    getSession.mockResolvedValue(GUARDIAN);
    db.parent.findFirst.mockResolvedValue({ guardians: [] });
    expect((await GET({} as never, ctx)).status).toBe(404);
    expect(db.parent.findFirst.mock.calls[0]![0].select.guardians.where).toEqual({ status: "ACTIVE" });
  });

  it("404 when the student is not linked to this guardian", async () => {
    getSession.mockResolvedValue(GUARDIAN);
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "other" }] });
    expect((await GET({} as never, ctx)).status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("404 when the raport exists but is not published (findFirst returns null)", async () => {
    getSession.mockResolvedValue(GUARDIAN);
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "s1" }] });
    db.term.findFirst.mockResolvedValue(TERM);
    db.student.findFirst.mockResolvedValue({ name: "Ali", enrollments: [] });
    db.reportCardEntry.findFirst.mockResolvedValue(null);
    db.studentMeasurement.findFirst.mockResolvedValue(null);
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    expect((await GET({} as never, ctx)).status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("constrains the entry query to PUBLISHED + non-deleted", async () => {
    getSession.mockResolvedValue(GUARDIAN);
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "s1" }] });
    db.term.findFirst.mockResolvedValue(TERM);
    db.student.findFirst.mockResolvedValue({ name: "Ali", enrollments: [] });
    db.reportCardEntry.findFirst.mockResolvedValue(ENTRY);
    db.studentMeasurement.findFirst.mockResolvedValue(null);
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF"));
    await GET({} as never, ctx);
    const where = db.reportCardEntry.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      tenantId: "t1",
      studentId: "s1",
      termId: "term1",
      status: "PUBLISHED",
      deletedAt: null,
    });
  });

  it("200 application/pdf for an owned, published raport", async () => {
    getSession.mockResolvedValue(GUARDIAN);
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "s1" }] });
    db.term.findFirst.mockResolvedValue(TERM);
    db.student.findFirst.mockResolvedValue({
      name: "Ali",
      enrollments: [{ classSection: { name: "TKIT A" } }],
    });
    db.reportCardEntry.findFirst.mockResolvedValue(ENTRY);
    db.studentMeasurement.findFirst.mockResolvedValue({ heightCm: "110.5", weightKg: "18.2" });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // R2-P-7: a readable name, not the raw student/term cuids.
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="rapor-ali-triwulan-1.pdf"');
    const props = renderToBuffer.mock.calls[0]![0].props.data;
    // R2-P-7: id-ID decimal comma.
    expect(props.height).toBe("110,5");
    expect(props.weight).toBe("18,2");
    expect(props.sections).toHaveLength(8);
    expect(props.className).toBe("TKIT A");
    const religious = props.sections.find((s: { label: string }) => s.label.includes("Agama"));
    expect(religious.level).toBe("Mampu dan Konsisten");
  });

  it("names the SEMESTER (sekolah) class, never the daycare one, for a dual-enrolled student", async () => {
    getSession.mockResolvedValue(GUARDIAN);
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "s1" }] });
    db.term.findFirst.mockResolvedValue(TERM);
    db.student.findFirst.mockResolvedValue({
      name: "Ali",
      enrollments: [
        {
          id: "enr-daycare",
          enrollDate: "2025-06-01",
          classSection: { name: "Daycare 1", program: { type: "YEAR_ROUND" } },
        },
        {
          id: "enr-sekolah",
          enrollDate: "2025-07-01",
          classSection: { name: "TKIT A", program: { type: "SEMESTER" } },
        },
      ],
    });
    db.reportCardEntry.findFirst.mockResolvedValue(ENTRY);
    db.studentMeasurement.findFirst.mockResolvedValue({ heightCm: "110.5", weightKg: "18.2" });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0]![0].props.data;
    expect(props.className).toBe("TKIT A");
  });
});
