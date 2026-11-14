/**
 * `GET /api/students/[id]/academics` — raport state + penilaian coverage per
 * triwulan.
 *
 * The contract that matters most is the query budget. Coverage costs one
 * aggregate query per term, so the route caps that to the ACTIVE academic
 * year's terms and returns `penilaian: null` for older ones. The last describe
 * block pins both halves: the cap holds, and the older terms still appear as
 * rows (their raport status is the point of the section).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Session = { id: string; role: string; tenantId: string | null; permissions?: string[] };

const state = {
  session: null as Session | null,
  student: null as Record<string, unknown> | null,
  terms: [] as Record<string, unknown>[],
  reportCards: [] as Record<string, unknown>[],
  enrolment: null as Record<string, unknown> | null,
  indicatorGroups: [] as { objectiveId: string; _count: { _all: number } }[],
  objectives: [] as { id: string; semesterId: string }[],
  /** indicatorId groups keyed by the term window the call asked for. */
  assessmentByStart: {} as Record<string, { indicatorId: string; _count: { _all: number } }[]>,
  assessmentCalls: [] as string[],
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const s = state.student;
        if (!s || s.id !== where.id || s.tenantId !== where.tenantId) return null;
        return s;
      }),
    },
    term: { findMany: vi.fn(async () => state.terms) },
    reportCardEntry: { findMany: vi.fn(async () => state.reportCards) },
    studentEnrollment: { findFirst: vi.fn(async () => state.enrolment) },
    assessmentEntry: {
      groupBy: vi.fn(async ({ where }: { where: { date: { gte: Date } } }) => {
        const key = where.date.gte.toISOString().slice(0, 10);
        state.assessmentCalls.push(key);
        return state.assessmentByStart[key] ?? [];
      }),
    },
    achievementIndicator: { groupBy: vi.fn(async () => state.indicatorGroups) },
    learningObjective: { findMany: vi.fn(async () => state.objectives) },
  },
}));

const { GET } = await import("@/app/api/students/[id]/academics/route");

const req = () => new Request("http://localhost/x") as never;
const ctx = (id = "s1") => ({ params: Promise.resolve({ id }) });

function term(
  id: string,
  number: number,
  start: string,
  end: string,
  yearStatus: string,
  yearName = "2025/2026",
  semesterId = "sem1",
) {
  return {
    id,
    number,
    startDate: new Date(`${start}T00:00:00.000Z`),
    endDate: new Date(`${end}T00:00:00.000Z`),
    semesterId,
    semester: { number: 1, academicYear: { name: yearName, status: yearStatus } },
  };
}

beforeEach(() => {
  state.session = { id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["students.view", "invoices.view"] };
  state.student = { id: "s1", tenantId: "t1" };
  state.terms = [
    term("old1", 1, "2024-07-15", "2024-09-30", "ARCHIVED", "2024/2025", "sem-old"),
    term("tw1", 1, "2025-07-14", "2025-09-30", "ACTIVE"),
    term("tw2", 2, "2025-10-01", "2025-12-19", "ACTIVE"),
  ];
  state.reportCards = [];
  state.enrolment = { classSection: { ageGroup: "B" } };
  state.indicatorGroups = [{ objectiveId: "o1", _count: { _all: 10 } }];
  state.objectives = [{ id: "o1", semesterId: "sem1" }];
  state.assessmentByStart = {};
  state.assessmentCalls = [];
});

describe("GET /api/students/[id]/academics — access", () => {
  it("403s a non-admin", async () => {
    state.session = { id: "u2", role: "GUARDIAN", tenantId: "t1" };
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it("404s a student in another tenant", async () => {
    state.student = { id: "s1", tenantId: "other" };
    expect((await GET(req(), ctx())).status).toBe(404);
  });
});

describe("GET /api/students/[id]/academics — rows", () => {
  it("returns one row per term, newest first", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body.data.rows.map((r: { term: { id: string } }) => r.term.id)).toEqual([
      "tw2",
      "tw1",
      "old1",
    ]);
  });

  it("labels each row and marks a term with no report card as NONE", async () => {
    state.reportCards = [
      { termId: "tw1", status: "PUBLISHED", publishedAt: new Date("2025-10-05"), updatedAt: new Date("2025-10-05") },
    ];
    const body = await (await GET(req(), ctx())).json();
    const rows = body.data.rows as { term: { id: string }; label: string; status: string }[];
    expect(rows.find((r) => r.term.id === "tw1")).toMatchObject({
      status: "PUBLISHED",
      label: "TW1 · Sem 1 · 2025/2026",
    });
    expect(rows.find((r) => r.term.id === "tw2")?.status).toBe("NONE");
    expect(body.data.tally).toEqual({ published: 1, draft: 0, total: 3 });
  });

  it("computes coverage from distinct indicators, not raw entry count", async () => {
    state.assessmentByStart["2025-07-14"] = [
      { indicatorId: "i1", _count: { _all: 4 } },
      { indicatorId: "i2", _count: { _all: 1 } },
    ];
    const body = await (await GET(req(), ctx())).json();
    const tw1 = body.data.rows.find((r: { term: { id: string } }) => r.term.id === "tw1");
    expect(tw1.penilaian).toEqual({
      entryCount: 5,
      indicatorsAssessed: 2,
      indicatorsTotal: 10,
      coveragePct: 20,
    });
  });

  it("reports coverage as null when there is no age-group cohort", async () => {
    state.enrolment = null;
    const body = await (await GET(req(), ctx())).json();
    expect(body.data.ageGroup).toBeNull();
    const tw1 = body.data.rows.find((r: { term: { id: string } }) => r.term.id === "tw1");
    expect(tw1.penilaian.coveragePct).toBeNull();
  });

  it("returns an empty row list for a tenant with no terms", async () => {
    state.terms = [];
    const body = await (await GET(req(), ctx())).json();
    expect(body.data.rows).toEqual([]);
    expect(body.data.currentTermId).toBeNull();
  });
});

describe("GET /api/students/[id]/academics — query budget", () => {
  it("computes penilaian only for the ACTIVE year's terms", async () => {
    await GET(req(), ctx());
    // Two aggregate calls, one per active-year term. The archived year's term
    // is never queried.
    expect(state.assessmentCalls.sort()).toEqual(["2025-07-14", "2025-10-01"]);
  });

  it("still lists the archived term, with penilaian explicitly not computed", async () => {
    // Dropping the row would hide the older raport the section exists to show;
    // reporting 0% would read as "nobody assessed this child".
    const body = await (await GET(req(), ctx())).json();
    const old = body.data.rows.find((r: { term: { id: string } }) => r.term.id === "old1");
    expect(old).toBeDefined();
    expect(old.penilaian).toBeNull();
  });
});
