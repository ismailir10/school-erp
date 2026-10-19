/**
 * `DossierSection` `summary` — a one-line answer in the collapsed header so a
 * closed section still says what is inside it. Shown only while closed; callers
 * that omit it are unchanged.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { DossierSection } from "../dossier-section";

function renderSection(props: { open: boolean; summary?: React.ReactNode }) {
  return render(
    <DossierSection id="documents" label="Dokumen" open={props.open} onOpenChange={() => {}} summary={props.summary}>
      <p>Isi dokumen</p>
    </DossierSection>,
  );
}

describe("DossierSection — summary", () => {
  it("shows the summary inside the trigger while closed", () => {
    renderSection({ open: false, summary: "KTP ada · KK belum ada" });
    const trigger = screen.getByRole("button", { name: /Dokumen/ });
    expect(trigger).toHaveTextContent("KTP ada · KK belum ada");
    // Part of the trigger's own name: nothing is announced twice.
    expect(trigger).toHaveAccessibleName("Dokumen KTP ada · KK belum ada");
  });

  it("hides the summary while open", () => {
    renderSection({ open: true, summary: "KTP ada · KK belum ada" });
    expect(screen.queryByText("KTP ada · KK belum ada")).not.toBeInTheDocument();
    expect(screen.getByText("Isi dokumen")).toBeInTheDocument();
  });

  it("renders nothing extra when the prop is omitted", () => {
    const { container } = renderSection({ open: false });
    expect(container.querySelector("[data-slot='dossier-summary']")).toBeNull();
    expect(screen.getByRole("button", { name: "Dokumen" })).toBeInTheDocument();
  });

  it("renders a ReactNode summary", () => {
    renderSection({ open: false, summary: <strong>2 anak</strong> });
    expect(screen.getByText("2 anak")).toBeInTheDocument();
  });
});
