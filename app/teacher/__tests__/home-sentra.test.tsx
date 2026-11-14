import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeacherHomeClient } from "../home-client";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const journal = { configured: true, totalStudents: 3, completeStudents: 1, completed: false, absentCount: 0 };
const sentra = { id: "c-sentra", name: "TK B", rosterCount: 3, attendanceRecorded: null, slot: null, journal, replies: [], sentraTag: "Sentra Balok", sentraOnly: true };
const base = { today: "2026-11-06", userName: "Sari", todayRecord: null };

describe("teacher home sentra card", () => {
  it("shows the tag and journal progress, links the journal, and offers no attendance CTA", () => {
    render(<TeacherHomeClient {...base} classes={[sentra]} />);
    expect(screen.getByTestId("sentra-tag")).toHaveTextContent("Sentra Balok · hari ini");
    expect(screen.getByText("1 dari 3 siswa lengkap")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "Lanjutkan jurnal harian" });
    expect(cta).toHaveAttribute("href", "/teacher/student-journal/entry?classId=c-sentra&date=2026-11-06");
    expect(screen.queryByText(/Absensi TK B/)).toBeNull();
    expect(screen.queryByText(/Buka absensi kelas/)).toBeNull();
  });
  it("keeps attendance for an assigned class that also hosts the sentra", () => {
    render(<TeacherHomeClient {...base} classes={[{ ...sentra, sentraOnly: false, attendanceRecorded: 1 }]} />);
    expect(screen.getByTestId("sentra-tag")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lanjutkan absensi · 1/3" })).toBeInTheDocument();
    expect(screen.queryByText("Absensi TK B")).toBeNull();
  });
});
