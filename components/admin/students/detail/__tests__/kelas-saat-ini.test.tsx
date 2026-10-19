import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { KelasSaatIniSection } from "../kelas-saat-ini";
import type { Enrollment } from "../types";

function enrollment(id: string, program: string, name: string): Enrollment {
  return {
    id,
    enrollDate: "2026-07-14",
    status: "ACTIVE",
    classSection: {
      id: `cs-${id}`,
      name,
      program: { name: program, code: "X", type: "SEMESTER" },
      academicYear: { name: "2026/2027", status: "ACTIVE" },
      campus: { name: "Taman Aster" },
    },
  };
}

describe("KelasSaatIniSection", () => {
  it("shows class, tahun ajaran, kampus and masuk sejak for the primary placement", () => {
    render(<KelasSaatIniSection enrollments={[enrollment("e1", "Kelompok Bermain", "KB A")]} joinedDate="2026-07-14" />);
    expect(screen.getByRole("heading", { level: 3, name: "Kelas saat ini" })).toBeInTheDocument();
    expect(screen.getByText("Kelompok Bermain · KB A")).toBeInTheDocument();
    expect(screen.getByText("2026/2027")).toBeInTheDocument();
    expect(screen.getByText("Taman Aster")).toBeInTheDocument();
    expect(screen.getByText("Masuk sejak")).toBeInTheDocument();
    expect(screen.getByText("14 Jul 2026")).toBeInTheDocument();
  });

  it("lists a second placement under its programme name", () => {
    render(
      <KelasSaatIniSection
        enrollments={[enrollment("e1", "Kelompok Bermain", "KB A"), enrollment("e2", "D'Care", "DCARE")]}
        joinedDate={null}
      />,
    );
    expect(screen.getByText("D'Care")).toBeInTheDocument();
    expect(screen.getByText("DCARE")).toBeInTheDocument();
    expect(screen.queryByText("Masuk sejak")).not.toBeInTheDocument();
  });

  it("says Belum terdaftar di kelas without a placement", () => {
    render(<KelasSaatIniSection enrollments={[]} joinedDate={null} />);
    expect(screen.getByText("Belum terdaftar di kelas")).toBeInTheDocument();
    expect(screen.queryByText("Tahun ajaran")).not.toBeInTheDocument();
  });
});
