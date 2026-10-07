import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const assignmentCount = vi.fn();
const getHomeroom = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => getSession() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    academicYear: { findFirst: vi.fn().mockResolvedValue({ id: "ay-1", name: "2026/2027" }) },
    teachingAssignment: { count: () => assignmentCount() },
  },
}));
vi.mock("@/lib/academic-period-db", () => ({
  getCurrentPeriodFromDb: vi.fn().mockResolvedValue("Semester 1 2026/2027"),
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
  });

  it("still renders the sentra tiles for a teacher with no class assignment (TCHX-5)", async () => {
    assignmentCount.mockResolvedValue(0);
    await renderPage();

    expect(screen.getByTestId("hub-no-class")).toHaveTextContent("Belum ditugaskan ke kelas");
    expect(screen.getByTestId("hub-center-grid")).toBeInTheDocument();
    expect(screen.getByTestId("hub-center-worship")).toHaveAttribute(
      "href",
      "/teacher/assessments/center/worship",
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
});
