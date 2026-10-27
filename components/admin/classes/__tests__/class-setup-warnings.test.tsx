import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ClassSetupWarnings } from "../class-setup-warnings";

describe("ClassSetupWarnings", () => {
  it("renders nothing when the setup is fine", () => {
    const { container } = render(<ClassSetupWarnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says a mislinked class does not match its program and where to fix it", () => {
    render(
      <ClassSetupWarnings
        warnings={[
          { kind: "PROGRAM_NAME_MISMATCH", classSectionId: "c1", className: "TK A 4", programName: "TK B" },
        ]}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Periksa dulu sebelum lanjut");
    expect(
      screen.getByText(
        "Nama TK A 4 tidak cocok dengan program TK B. Kalau salah, ubah program kelas ini lewat Kelas → Ubah Kelas sebelum membuat tagihan.",
      ),
    ).toBeInTheDocument();
  });

  it("says a class without a fee structure will not be billed", () => {
    render(
      <ClassSetupWarnings
        warnings={[{ kind: "NO_FEE_STRUCTURE", classSectionId: "c2", className: "KB 1", programName: "KB" }]}
      />,
    );

    expect(
      screen.getByText(
        "KB 1 memakai program KB, yang belum punya tarif rutin tahun ajaran ini. Siswanya tidak akan ditagih.",
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
