/**
 * `GET /api/students/[id]/overview` — the dossier's aggregate route.
 *
 * Two things are worth pinning here beyond the happy path: the admin gate (this
 * route reads a child's money, attendance and raport state), and that it stays
 * an *aggregate* route. The last test asserts no `findMany` over invoices,
 * attendance or penilaian is ever issued — the whole reason increments 1 and 2
 * shipped those rail tiles blank was that filling them meant a row dump on
 * every student-detail view.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Session = { id: string; role: string; tenantId: string | null };

const state = {
  session: null as Session | null,
  student: null as Record<string, unknown> | null,
  invoiceGroups: [] as { status: string; _count: { _all: number }; _sum: { totalDue: unknown; totalPaid: unknown } }[],
  attendanceGroups: [] as { status: string; _count: { _all: number } }[],
  terms: [] as Record<string, unknown>[],
  reportCards: [] as Record<string, unknown>[],
  assessmentGroups: [] as { indicatorId: string; _count: { _all: number } }[],
  indicatorGroups: [] as { objectiveId: string; _count: { _all: number } }[],
  objectives: [] as { id: string; semesterId: string }[],
  enrolment: null as Record<string, unknown> | null,
  application: null as Record<string, unknown> | null,
  /** Every prisma method the route touched, for the no-row-dump assertion. */
  calls: [] as string[],
};

function track<T>(name: string, fn: () => T): T {
  state.calls.push(name);
  return fn();
}

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) =>
        track("student.findFirst", () => {
          const s = state.student;
          if (!s || s.id !== where.id || s.tenantId !== where.tenantId) return null;
          return s;
        }),
      ),
    },
    invoice: {
      groupBy: vi.fn(async () => track("invoice.groupBy", () => state.invoiceGroups)),
      findMany: vi.fn(async () => track("invoice.findMany", () => [])),
    },
    studentAttendance: {
      groupBy: vi.fn(async () => track("studentAttendance.groupBy", () => state.attendanceGroups)),
      findMany: vi.fn(async () => track("studentAttendance.findMany", () => [])),
    },
    assessmentEntry: {
      groupBy: vi.fn(async () => track("assessmentEntry.groupBy", () => state.assessmentGroups)),
      findMany: vi.fn(async () => track("assessmentEntry.findMany", () => [])),
    },
    achievementIndicator: {
      groupBy: vi.fn(async () => track("achievementIndicator.groupBy", () => state.indicatorGroups)),
    },
    learningObjective: {
      findMany: vi.fn(async () => track("learningObjective.findMany", () => state.objectives)),
    },
    term: {
      findMany: vi.fn(async () => track("term.findMany", () => state.terms)),
    },
    reportCardEntry: {
      findMany: vi.fn(async () => track("reportCardEntry.findMany", () => state.reportCards)),
    },
    studentEnrollment: {
      findFirst: vi.fn(async () => track("studentEnrollment.findFirst", () => state.enrolment)),
    },
    enrollmentApplication: {
      findFirst: vi.fn(async () => track("enrollmentApplication.findFirst", () => state.application)),
    },
  },
}));

const { GET } = await import("@/app/api/students/[id]/overview/route");

const req = () => new Request("http://localhost/api/students/s1/overview") as never;
const ctx = (id = "s1") => ({ params: Promise.resolve({ id }) });

/** A term window that always contains "now", so `pickCurrentTerm` selects it. */
function liveTerm() {
  const from = new Date(Date.now() - 30 * 86400_000);
  const to = new Date(Date.now() + 30 * 86400_000);
  return {
    id: "tw2",
    number: 2,
    startDate: from,
    endDate: to,
    semesterId: "sem1",
    semester: { number: 1, academicYear: { name: "2025/2026", status: "ACTIVE" } },
  };
}

beforeEach(() => {
  state.session = { id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1" };
  state.student = { id: "s1", tenantId: "t1", photoUrl: "photo.jpg", guardians: [] };
  state.invoiceGroups = [];
  state.attendanceGroups = [];
  state.terms = [];
  state.reportCards = [];
  state.assessmentGroups = [];
  state.indicatorGroups = [];
  state.objectives = [];
  state.enrolment = null;
  state.application = null;
  state.calls = [];
});

describe("GET /api/students/[id]/overview — access", () => {
  it("403s an unauthenticated caller", async () => {
    state.session = null;
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("403s a teacher", async () => {
    state.session = { id: "u2", role: "TEACHER", tenantId: "t1" };
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("403s a guardian", async () => {
    state.session = { id: "u3", role: "GUARDIAN", tenantId: "t1" };
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("404s a student in another tenant", async () => {
    state.student = { id: "s1", tenantId: "other", photoUrl: null, guardians: [] };
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
  });
});

describe("GET /api/students/[id]/overview — aggregates", () => {
  it("returns the invoice breakdown ordered owed-first", async () => {
    state.invoiceGroups = [
      { status: "PAID", _count: { _all: 6 }, _sum: { totalDue: "3000000", totalPaid: "3000000" } },
      { status: "OVERDUE", _count: { _all: 2 }, _sum: { totalDue: "1000000", totalPaid: "100000" } },
    ];
    const body = await (await GET(req(), ctx())).json();
    expect(body.finance.invoiceCount).toBe(8);
    expect(body.finance.byStatus.map((g: { status: string }) => g.status)).toEqual([
      "OVERDUE",
      "PAID",
    ]);
    expect(body.finance.byStatus[0].balance).toBe(900000);
  });

  it("counts this month's attendance by status", async () => {
    state.attendanceGroups = [
      { status: "PRESENT", _count: { _all: 15 } },
      { status: "ABSENT", _count: { _all: 2 } },
    ];
    const body = await (await GET(req(), ctx())).json();
    expect(body.attendance.counts).toMatchObject({ present: 15, absent: 2, total: 17 });
    expect(body.attendance.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("reports penilaian coverage for the current term", async () => {
    state.terms = [liveTerm()];
    state.enrolment = { classSection: { ageGroup: "B" } };
    state.assessmentGroups = [
      { indicatorId: "i1", _count: { _all: 3 } },
      { indicatorId: "i2", _count: { _all: 2 } },
    ];
    state.indicatorGroups = [{ objectiveId: "o1", _count: { _all: 8 } }];
    state.objectives = [{ id: "o1", semesterId: "sem1" }];

    const body = await (await GET(req(), ctx())).json();
    expect(body.penilaian).toMatchObject({
      entryCount: 5,
      indicatorsAssessed: 2,
      indicatorsTotal: 8,
      coveragePct: 25,
    });
    expect(body.penilaian.term.label).toBe("TW2 · Sem 1 · 2025/2026");
  });

  it("reports coverage as null when the student has no active enrolment", async () => {
    state.terms = [liveTerm()];
    state.enrolment = null; // no class section → no age-group cohort
    state.assessmentGroups = [{ indicatorId: "i1", _count: { _all: 3 } }];

    const body = await (await GET(req(), ctx())).json();
    expect(body.penilaian.coveragePct).toBeNull();
    expect(body.penilaian.indicatorsTotal).toBe(0);
  });

  it("tallies raport across every term, counting a missing one as not-made", async () => {
    state.terms = [
      { ...liveTerm(), id: "tw1", number: 1, startDate: new Date("2025-07-14"), endDate: new Date("2025-09-30") },
      liveTerm(),
    ];
    state.reportCards = [
      { termId: "tw1", status: "PUBLISHED", publishedAt: new Date("2025-10-01"), updatedAt: new Date("2025-10-01") },
    ];
    const body = await (await GET(req(), ctx())).json();
    expect(body.raport).toMatchObject({ published: 1, draft: 0, total: 2 });
    expect(body.raport.current).toMatchObject({ termId: "tw2", status: "NONE" });
  });

  it("is null-safe on a tenant with no terms at all", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body.penilaian).toBeNull();
    expect(body.raport).toMatchObject({ published: 0, draft: 0, total: 0, current: null });
  });

  it("reports document presence, including consent only when a form exists", async () => {
    state.student = {
      id: "s1",
      tenantId: "t1",
      photoUrl: null,
      guardians: [
        { parent: { ktpUrl: "a.jpg", kkUrl: "kk.jpg" } },
        { parent: { ktpUrl: null, kkUrl: null } },
      ],
    };
    state.application = {
      id: "app1",
      status: "ACCEPTED",
      submittedAt: new Date("2026-05-02T03:00:00.000Z"),
      consentData: { agreed: true },
    };
    const body = await (await GET(req(), ctx())).json();
    expect(body.documents).toEqual({
      photo: false,
      kk: true,
      ktpPresent: 1,
      ktpTotal: 2,
      consent: true,
      enrollment: { done: 0, required: 9 },
    });
    expect(body.enrollmentApplication).toMatchObject({ id: "app1", status: "ACCEPTED" });
  });

  it("says there is no application for a hand-entered student", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body.enrollmentApplication).toBeNull();
    expect(body.documents.consent).toBe(false);
    expect(body.documents.enrollment).toBeNull();
  });

  it("reports Kelengkapan Berkas progress from the application, counting uploads and physical receipts", async () => {
    state.application = {
      id: "app1",
      status: "ACCEPTED",
      submittedAt: null,
      consentData: {},
      documents: {
        kk: { fileToken: "supabase:v1:enrollment/app1/doc-kk-SECRET.pdf", fileName: "kk.pdf" },
        akta: { receivedPhysical: true },
        lainnya: { fileToken: "supabase:v1:enrollment/app1/doc-lainnya-SECRET2.pdf", fileName: "x.pdf" }, // optional: not counted
      },
    };
    const res = await GET(req(), ctx());
    const raw = await res.text();
    expect(JSON.parse(raw).documents.enrollment).toEqual({ done: 2, required: 9 });
    expect(raw).not.toContain("SECRET");
    expect(raw).not.toContain("fileToken");
  });

  it("counts zero when the application has no documents column value", async () => {
    state.application = { id: "app1", status: "ACCEPTED", submittedAt: null, consentData: {}, documents: null };
    const body = await (await GET(req(), ctx())).json();
    expect(body.documents.enrollment).toEqual({ done: 0, required: 9 });
  });
});

describe("GET /api/students/[id]/overview — stays an aggregate route", () => {
  it("never dumps invoice, attendance or penilaian rows", async () => {
    state.terms = [liveTerm()];
    state.enrolment = { classSection: { ageGroup: "A" } };
    await GET(req(), ctx());

    expect(state.calls).toContain("invoice.groupBy");
    expect(state.calls).toContain("studentAttendance.groupBy");
    expect(state.calls).toContain("assessmentEntry.groupBy");
    for (const forbidden of [
      "invoice.findMany",
      "studentAttendance.findMany",
      "assessmentEntry.findMany",
    ]) {
      expect(state.calls).not.toContain(forbidden);
    }
  });
});
