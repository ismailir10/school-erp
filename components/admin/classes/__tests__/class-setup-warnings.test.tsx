import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ClassSetupWarnings } from "../class-setup-warnings";

describe("ClassSetupWarnings", () => {
  it("keeps an empty live region mounted, with nothing visible, when the setup is fine", () => {
    render(<ClassSetupWarnings warnings={[]} />);

    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass("empty:hidden");
  });

  it("announces a warning inside the same live region", () => {
    const { rerender } = render(<ClassSetupWarnings warnings={[]} />);
    const region = screen.getByRole("status");

    rerender(
      <ClassSetupWarnings
        warnings={[{ kind: "NO_FEE_STRUCTURE", classSectionId: "c1", className: "KB 1", programName: "KB" }]}
      />,
    );

    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("KB 1 memakai program KB");
  });

  it("says a mislinked class does not match its program and where to fix it", () => {
    render(
      <ClassSetupWarnings
        warnings={[
          { kind: "PROGRAM_NAME_MISMATCH", classSectionId: "c1", className: "TK A 4", programName: "TK B" },
        ]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Periksa sebelum lanjut");
    expect(screen.getByText("Nama TK A 4 tidak cocok dengan program TK B.")).toBeInTheDocument();
    expect(screen.getByText("Jika salah, ubah program di Kelas → Ubah Kelas sebelum membuat tagihan.")).toBeInTheDocument();
  });

  it("says where to fix a mislinked class once, however many look mislinked", () => {
    render(
      <ClassSetupWarnings
        warnings={["TK A 1", "TK A 3", "TK A 4"].map((className, i) => ({
          kind: "PROGRAM_NAME_MISMATCH" as const,
          classSectionId: `c${i}`,
          className,
          programName: "TK B",
        }))}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText(/Jika salah, ubah program/)).toHaveLength(1);
  });

  it("adds no fix-it sentence when only fee structures are missing", () => {
    render(
      <ClassSetupWarnings
        warnings={[{ kind: "NO_FEE_STRUCTURE", classSectionId: "c1", className: "KB 1", programName: "KB" }]}
      />,
    );

    expect(screen.queryByText(/Jika salah, ubah program/)).not.toBeInTheDocument();
  });

  it("says a class without a fee structure will not be billed", () => {
    render(
      <ClassSetupWarnings
        warnings={[{ kind: "NO_FEE_STRUCTURE", classSectionId: "c2", className: "KB 1", programName: "KB" }]}
      />,
    );

    expect(
      screen.getByText(
        "KB 1 memakai program KB, yang belum ada tarif rutin tahun ajaran ini. Siswanya tidak akan ditagih.",
      ),
    ).toBeInTheDocument();
  });

  it("lists one item per warning and takes a custom title", () => {
    render(
      <ClassSetupWarnings
        title="Periksa kelas ini"
        warnings={[
          { kind: "NO_FEE_STRUCTURE", classSectionId: "c1", className: "A", programName: "P" },
          { kind: "PROGRAM_NAME_MISMATCH", classSectionId: "c1", className: "A", programName: "P" },
        ]}
      />,
    );

    expect(screen.getByText("Periksa kelas ini")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
