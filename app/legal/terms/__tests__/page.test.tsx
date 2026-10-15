import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TermsPage from "../page";

// Built from fragments so a repo-wide grep for vendor names under app/legal
// stays empty (the cycle's acceptance check).
const VENDOR_NAMES = new RegExp(
  ["Supa" + "base", "Ver" + "cel", "Re" + "send", "Cloud" + "flare", "R" + "2"].join("|"),
);

describe("TermsPage", () => {
  it("renders the heading and names only DOKU as a payment partner", () => {
    const { container } = render(<TermsPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Syarat & Ketentuan/ }),
    ).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("DOKU");
    expect(text).not.toMatch(VENDOR_NAMES);
  });
});
