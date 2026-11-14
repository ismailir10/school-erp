import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, renderToBuffer, db } = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  renderToBuffer: vi.fn(),
  db: {
    term: { findFirst: vi.fn() },
    student: { findFirst: vi.fn() },
    reportCardEntry: { findFirst: vi.fn() },
    studentMeasurement: { findFirst: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@react-pdf/renderer", () => ({
  Font: { register: vi.fn() },
  renderToBuffer,
  StyleSheet: { create: (x: unknown) => x },
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { GET } from "@/app/api/admin/report-cards/[studentId]/[termId]/pdf/route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };
const DENY = { error: Response.json({ error: "forbidden" }, { status: 403 }) };
const ctx = { params: Promise.resolve({ studentId: "s1", termId: "term1" }) };
const TERM = { id: "term1", number: 1, startDate: new Date(), endDate: new Date(), semester: { number: 1, academicYear: { name: "2025/2026" } } };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/report-cards/[studentId]/[termId]/pdf", () => {
  it("403 when denied", async () => {
    requirePermission.mockResolvedValue(DENY);
    expect((await GET({} as never, ctx)).status).toBe(403);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("404 when no saved entry", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.term.findFirst.mockResolvedValue(TERM);
    db.student.findFirst.mockResolvedValue({ name: "Ali", enrollments: [] });
    db.reportCardEntry.findFirst.mockResolvedValue(null);
    db.studentMeasurement.findFirst.mockResolvedValue(null);
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    expect((await GET({} as never, ctx)).status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("200 application/pdf for a saved entry", async () => {
    requirePermission.mockResolvedValue(ALLOW);
    db.term.findFirst.mockResolvedValue(TERM);
    db.student.findFirst.mockResolvedValue({ name: "Ali", enrollments: [{ classSection: { name: "TK A1" } }] });
    db.reportCardEntry.findFirst.mockResolvedValue({
      sectionLevels: { RELIGIOUS_MORAL: "CONSISTENT" },
      sectionNarratives: { RELIGIOUS_MORAL: "Berkembang baik", CLOSING: "Terus semangat" },
      sickDays: 1,
      permittedAbsenceDays: 0,
      unexcusedAbsenceDays: 2,
      totalSchoolDays: 60,
      memorizationNotes: "Al-Fatihah",
    });
    db.studentMeasurement.findFirst.mockResolvedValue({ heightCm: "110.5", weightKg: "18.2" });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(renderToBuffer).toHaveBeenCalledTimes(1);
    // sections assembled from labels: 5 bucketed + 3 closing = 8
    const props = renderToBuffer.mock.calls[0][0].props.data;
    expect(props.sections).toHaveLength(8);
    expect(props.className).toBe("TK A1");
    // level-bearing section maps level → Indonesian label
    const religious = props.sections.find((s: { label: string }) => s.label.includes("Agama"));
    expect(religious.level).toBe("Mampu dan Konsisten");
  });

  it("names the SEMESTER (sekolah) class, never the daycare one, for a dual-enrolled student", async () => {
    requirePermission.mockResolvedValue(ALLOW);
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
          classSection: { name: "TK A1", program: { type: "SEMESTER" } },
        },
      ],
    });
    db.reportCardEntry.findFirst.mockResolvedValue({
      sectionLevels: { RELIGIOUS_MORAL: "CONSISTENT" },
      sectionNarratives: { RELIGIOUS_MORAL: "Berkembang baik", CLOSING: "Terus semangat" },
      sickDays: 1,
      permittedAbsenceDays: 0,
      unexcusedAbsenceDays: 2,
      totalSchoolDays: 60,
      memorizationNotes: "Al-Fatihah",
    });
    db.studentMeasurement.findFirst.mockResolvedValue({ heightCm: "110.5", weightKg: "18.2" });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0][0].props.data;
    expect(props.className).toBe("TK A1");
  });

  it("names the CURRENT-year class, not a stale ARCHIVED-year row (T9 regression) — the enrollments query excludes archived years", async () => {
    // Regression for the T9 bug: a student can carry a stale un-closed
    // ACTIVE row in an ARCHIVED prior year (bulk-import artifact) alongside
    // the real current-year ACTIVE row. Both are SEMESTER, so unfiltered
    // they'd both land in `pickPrimaryEnrollment`'s pool and the earliest-
    // enrollDate tiebreak would deterministically pick the archived one.
    // The fix scopes the Prisma query itself to non-ARCHIVED years, so we
    // assert the `where` shape sent to Prisma carries that predicate —
    // proving the archived row can never reach `pickPrimaryEnrollment` in
    // the first place.
    requirePermission.mockResolvedValue(ALLOW);
    db.term.findFirst.mockResolvedValue(TERM);
    // Mock resolves as if Prisma already applied the archived-year filter —
    // only the current-year row comes back.
    db.student.findFirst.mockResolvedValue({
      name: "Ali",
      enrollments: [
        {
          id: "enr-current",
          enrollDate: "2025-07-10",
          classSection: { name: "TK A1 (2025/2026)", program: { type: "SEMESTER" } },
        },
      ],
    });
    db.reportCardEntry.findFirst.mockResolvedValue({
      sectionLevels: { RELIGIOUS_MORAL: "CONSISTENT" },
      sectionNarratives: { RELIGIOUS_MORAL: "Berkembang baik", CLOSING: "Terus semangat" },
      sickDays: 1,
      permittedAbsenceDays: 0,
      unexcusedAbsenceDays: 2,
      totalSchoolDays: 60,
      memorizationNotes: "Al-Fatihah",
    });
    db.studentMeasurement.findFirst.mockResolvedValue({ heightCm: "110.5", weightKg: "18.2" });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0][0].props.data;
    expect(props.className).toBe("TK A1 (2025/2026)");

    // The query itself must exclude ARCHIVED-year enrollments.
    expect(db.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          enrollments: expect.objectContaining({
            where: expect.objectContaining({
              status: "ACTIVE",
              classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
            }),
          }),
        }),
      }),
    );
  });
});
