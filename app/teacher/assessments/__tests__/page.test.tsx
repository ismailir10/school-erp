import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const assignmentCount = vi.fn();
const getHomeroom = vi.fn();
const sentraFindMany = vi.fn();
const sentraToday = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => getSession() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    academicYear: { findFirst: vi.fn().mockResolvedValue({ id: "ay-1", name: "2026/2027" }) },
    teachingAssignment: { count: () => assignmentCount() },
    employee: { findFirst: vi.fn().mockResolvedValue({ campusId: "camp1" }) },
    sentra: { findMany: (...a: unknown[]) => sentraFindMany(...a) },
  },
}));
vi.mock("@/lib/academic-period-db", () => ({
  getCurrentPeriodFromDb: vi.fn().mockResolvedValue("Semester 1 2026/2027"),
}));
vi.mock("@/lib/sentra/access", () => ({
  getTeacherSentraToday: (...args: unknown[]) => sentraToday(...args),
}));
vi.mock("@/lib/curriculum/homeroom", () => ({
  getHomeroomClassSection: (...args: unknown[]) => getHomeroom(...args),
}));

import TeacherAssessmentsPage from "../page";

async function renderPage() {
  render(await TeacherAssessmentsPage());
}

describe("TeacherAssessmentsPage", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ role: "TEACHER", tenantId: "t1", employeeId: "e1" });
    getHomeroom.mockResolvedValue(null);
    sentraToday.mockResolvedValue([]);
    sentraFindMany.mockResolvedValue([
      { id: "sen-a", name: "Ibadah", teachers: [] },
      { id: "sen-b", name: "Balok", teachers: [{ id: "st1" }] },
    ]);
  });

  it("still renders the sentra tiles for a teacher with no class assignment (TCHX-5)", async () => {
    assignmentCount.mockResolvedValue(0);
    await renderPage();

    expect(screen.getByTestId("hub-no-class")).toHaveTextContent("Belum ditugaskan ke kelas");
    expect(screen.getByTestId("hub-center-grid")).toBeInTheDocument();
    expect(screen.getByTestId("hub-center-sen-a")).toHaveAttribute(
      "href",
      "/teacher/assessments/center/sen-a",
    );
    expect(screen.queryByTestId("hub-weekly-card")).toBeNull();
  });

  it("shows the weekly card and no notice for a walas", async () => {
    assignmentCount.mockResolvedValue(1);
    getHomeroom.mockResolvedValue({ id: "c1", name: "TK-B Anggur" });
    await renderPage();

    expect(screen.getByTestId("hub-weekly-card")).toBeInTheDocument();
    expect(screen.queryByTestId("hub-no-class")).toBeNull();
    expect(screen.getByTestId("hub-center-grid")).toBeInTheDocument();
  });

  it("puts the guru's own sentra first with a badge and today's class", async () => {
    assignmentCount.mockResolvedValue(1);
    sentraToday.mockResolvedValue([
      { sentraId: "sen-b", sentraName: "Balok", classSectionId: "c9", className: "TK B 3", rotationId: "r1" },
    ]);
    await renderPage();

    const tiles = screen.getByTestId("hub-center-grid").querySelectorAll("a");
    expect(tiles[0]).toHaveAttribute("href", "/teacher/assessments/center/sen-b");
    expect(tiles[0]).toHaveTextContent("Sentra saya");
    expect(tiles[0]).toHaveTextContent("Hari ini: TK B 3");
    expect(tiles[1]).not.toHaveTextContent("Sentra saya");
  });

  it("shows the empty state when the campus has no active sentra", async () => {
    assignmentCount.mockResolvedValue(1);
    sentraFindMany.mockResolvedValue([]);
    await renderPage();

    expect(screen.getByText("Belum ada sentra di kampus ini.")).toBeInTheDocument();
    expect(screen.getByText("Minta admin menambahkannya di menu Sentra.")).toBeInTheDocument();
  });
});
