import { beforeEach, describe, expect, it, vi } from "vitest";

type Props = { classes: Array<{ id: string; sentraTag?: string; sentraOnly?: boolean; journal: unknown }>; classesUnavailable: boolean };
const m = vi.hoisted(() => ({
  clientProps: null as unknown as Props,
  sentra: vi.fn(),
  classSectionFindMany: vi.fn(),
  assignments: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ id: "u1", role: "TEACHER", name: "Sari", employeeId: "e1", tenantId: "t1" }) }));
vi.mock("@/lib/attendance/timezone", () => ({ getTodayInTimezone: () => "2026-11-06" }));
vi.mock("@/lib/sentra/access", () => ({ getTeacherSentraToday: m.sentra }));
vi.mock("@/lib/student-journal/note-reads", () => ({ countUnreadNotesByStudent: async () => ({}) }));
vi.mock("@/lib/student-journal/day-marks", () => ({ getDayMark: async () => null }));
vi.mock("../home-client", () => ({ TeacherHomeClient: (p: Props) => { m.clientProps = p; return null; } }));
vi.mock("@/lib/db", () => ({
  prisma: {
    attendanceRecord: { findUnique: async () => null },
    teachingAssignment: { findMany: m.assignments },
    classSession: { findMany: async () => [] },
    studentJournalIndicator: { findMany: async () => [{ id: "i1" }] },
    leaveRequest: { findMany: async () => [] },
    orgConfig: { findUnique: async () => null },
    classSection: { findMany: m.classSectionFindMany },
    studentAttendance: { findMany: async () => [] },
    studentJournalEntry: { findMany: async () => [] },
  },
}));

import TeacherHome from "../page";

const section = (id: string, name: string) => ({ id, name, sessions: [], enrollments: [{ studentId: `${id}-s1`, student: { name: "Ani", nickname: null } }] });

beforeEach(() => {
  m.assignments.mockReset().mockResolvedValue([{ classSectionId: "own", role: "HOMEROOM", classSection: section("own", "TK A") }]);
  m.classSectionFindMany.mockReset().mockResolvedValue([section("visit", "TK B")]);
  m.sentra.mockReset();
});

describe("TeacherHome sentra classes", () => {
  it("adds a sentra-only class with tag and journal progress, scoped to tenant", async () => {
    m.sentra.mockResolvedValue([{ sentraName: "Balok", classSectionId: "visit" }]);
    m.clientProps = (await TeacherHome() as unknown as { props: Props }).props;
    const { classes } = m.clientProps;
    expect(classes.map((c) => c.id).sort()).toEqual(["own", "visit"]);
    const visit = classes.find((c) => c.id === "visit");
    expect(visit).toMatchObject({ sentraTag: "Sentra Balok", sentraOnly: true });
    expect(visit?.journal as object).toMatchObject({ totalStudents: 1 });
    expect(classes.find((c) => c.id === "own")?.sentraTag).toBeUndefined();
    expect(m.classSectionFindMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["visit"] }, tenantId: "t1", status: "ACTIVE" });
  });
  it("does not duplicate an assigned class, only tags it", async () => {
    m.sentra.mockResolvedValue([{ sentraName: "Sentra Balok", classSectionId: "own" }]);
    m.clientProps = (await TeacherHome() as unknown as { props: Props }).props;
    expect(m.clientProps.classes).toHaveLength(1);
    expect(m.clientProps.classes[0]).toMatchObject({ id: "own", sentraTag: "Sentra Balok", sentraOnly: false });
    expect(m.classSectionFindMany).not.toHaveBeenCalled();
  });
  it("still renders the home when the sentra lookup rejects", async () => {
    m.sentra.mockRejectedValue(new Error("boom"));
    m.clientProps = (await TeacherHome() as unknown as { props: Props }).props;
    expect(m.clientProps.classes.map((c) => c.id)).toEqual(["own"]);
    expect(m.clientProps.classesUnavailable).toBe(false);
  });
});
