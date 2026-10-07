import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KidCard } from "../kid-card";

describe("KidCard", () => {
  it("offers recognizable child-specific destinations without losing context", () => {
    render(
      <KidCard
        id="student-2"
        name="Alya Putri"
        className="TK B Anggrek"
        todayStatus="PRESENT"
        teacherNote="Alya mulai percaya diri memimpin doa bersama teman-temannya."
        foot={{ tone: "ok", text: "Hadir 2 hari pekan ini" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Alya Putri" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baca catatan" })).toHaveAttribute(
      "href",
      "/parent/student-journal?child=student-2&view=notes",
    );
    expect(screen.getByRole("link", { name: "Lihat kehadiran" })).toHaveAttribute(
      "href",
      "/parent/attendance?child=student-2",
    );
    expect(screen.getByRole("link", { name: "Perkembangan" })).toHaveAttribute(
      "href",
      "/parent/perkembangan/student-2",
    );
    expect(screen.getByRole("link", { name: "Rapor" })).toHaveAttribute(
      "href",
      "/parent/reports?child=student-2",
    );
    expect(screen.getByRole("link", { name: "Tagihan" })).toHaveAttribute(
      "href",
      "/parent/invoices?child=student-2",
    );
    expect(screen.getByText(/Catatan guru:/).closest("p")).toHaveTextContent("Alya mulai percaya diri");
    expect(screen.getByText("Hadir")).toBeInTheDocument();
  });

  it("does not present an unrecorded attendance day as present", () => {
    render(<KidCard id="student-2" name="Bilal Zhafran" className="TK A" todayStatus={null} teacherNote={null} foot={{ tone: "info", text: "Pekan ini belum tercatat" }} />);
    expect(screen.getByText("Belum dicatat")).toBeInTheDocument();
    expect(screen.queryByText("Hadir")).not.toBeInTheDocument();
    expect(screen.getByText(/Belum ada catatan guru terbaru/)).toBeInTheDocument();
  });
});

it("labels conflicting classroom records explicitly and offers the child's attendance destination",()=>{
 render(<KidCard id="child" name="Alya" className="Sekolah dan Daycare" todayStatus="MIXED" teacherNote={null} foot={{tone:"info",text:"Catatan berbeda antar kelas"}}/>);
 expect(screen.getByText("Catatan berbeda",{exact:true})).toBeInTheDocument();
 expect(screen.queryByText("Belum dicatat")).not.toBeInTheDocument();
 expect(screen.getByRole("link",{name:"Lihat kehadiran"})).toHaveAttribute("href","/parent/attendance?child=child");
});

describe("KidCard tap targets (PAR-14)", () => {
  it("gives the Rapor link a 44px-wide and tall hit area", () => {
    render(
      <KidCard id="s1" name="Alya" className="TK A" todayStatus="PRESENT" teacherNote={null} foot={{ tone: "ok", text: "ok" }} />,
    );
    const link = screen.getByRole("link", { name: "Rapor" });
    expect(link).toHaveClass("min-h-11");
    expect(link).toHaveClass("min-w-11");
  });
});
