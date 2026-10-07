import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { EnrollmentApplicationView } from "../enrollment-application-view";

function rowValue(label: string, index = 0): string {
  return screen.getAllByText(label)[index].nextElementSibling?.textContent ?? "";
}

function renderView(student: object, ayah: object = {}, ibu: object = {}) {
  render(
    <EnrollmentApplicationView
      application={{
        id: "app-1",
        studentData: student,
        ayahData: ayah,
        ibuData: ibu,
        consentData: {},
      }}
    />,
  );
}

describe("EnrollmentApplicationView birth dates", () => {
  it("renders the child and both parents' birth dates as readable dates", () => {
    renderView(
      { childName: "Aisyah", birthPlace: "Bekasi", dateOfBirth: "2022-03-15" },
      { name: "Budi", birthPlace: "Bogor", dateOfBirth: "1990-12-01" },
      { name: "Siti", dateOfBirth: "1992-07-09" },
    );
    expect(rowValue("Tempat, tanggal lahir", 0)).toBe("Bekasi, 15 Mar 2022");
    expect(rowValue("Tempat, tanggal lahir", 1)).toBe("Bogor, 1 Des 1990");
    expect(rowValue("Tempat, tanggal lahir", 2)).toBe("9 Jul 1992");
  });

  it("keeps an em dash when the birth date is empty and passes odd values through", () => {
    renderView({ childName: "Aisyah" }, { dateOfBirth: "awal 1990-an" }, {});
    expect(rowValue("Tempat, tanggal lahir", 0)).toBe("—");
    expect(rowValue("Tempat, tanggal lahir", 1)).toBe("awal 1990-an");
  });
});
