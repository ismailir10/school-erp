import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage from "../page";

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
    expect(screen.getByText(/8 Oktober 2026/)).toBeTruthy();
  });
});
