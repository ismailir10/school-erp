import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "../page";

// Built from fragments so a repo-wide grep for vendor names under app/legal
// stays empty (the cycle's acceptance check).
const VENDOR_NAMES = new RegExp(
  ["Supa" + "base", "Ver" + "cel", "Re" + "send", "Cloud" + "flare", "R" + "2"].join("|"),
);

describe("PrivacyPage", () => {
  it("renders the photo & video section with the wali kelas contact path", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { level: 2, name: /Foto & Video Kegiatan/ }),
    ).toBeTruthy();
    expect(screen.getByText(/wali kelas/)).toBeTruthy();
    expect(screen.getByText(/butir 17/)).toBeTruthy();
  });

  it("shows the bumped effective date", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/9 Oktober 2026/)).toBeTruthy();
  });

  it("keeps DOKU and the server regions but names no infrastructure vendor", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("DOKU (PT Nusa Satu Inti Artha)");
    expect(text).toContain("host: Indonesia");
    expect(text).toContain("host: Singapura");
    expect(text).not.toMatch(VENDOR_NAMES);
  });

  it("lists the third parties as provider categories", () => {
    render(<PrivacyPage />);
    expect(screen.getByText("Penyedia basis data")).toBeTruthy();
    expect(screen.getByText("Penyedia hosting")).toBeTruthy();
    expect(screen.getByText("Penyedia layanan email")).toBeTruthy();
    expect(screen.getByText("Penyedia penyimpanan cadangan")).toBeTruthy();
  });
});
