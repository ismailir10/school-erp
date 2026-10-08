import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignaturePad } from "../signature-pad";
import { stubMatchMedia } from "@/components/reactbits/__tests__/motion-test-utils";

beforeEach(() => {
  // jsdom has no canvas; the pad only needs getContext to return nothing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SignaturePad saved state", () => {
  it("shows the Tersimpan text with a decorative drawn check", () => {
    const { container } = render(<SignaturePad label="Tanda tangan Ayah" saved onSave={vi.fn()} />);
    const badge = screen.getByText(/Tersimpan/);
    const svg = badge.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "16");
    expect(screen.getByText("Tanda tangan sudah tersimpan. Gambar ulang jika ingin mengganti.")).toBeInTheDocument();
    expect(container.querySelector("canvas")).toHaveAttribute("aria-label", "Area tanda tangan Tanda tangan Ayah");
  });

  it("shows neither the badge nor the check when not saved", () => {
    render(<SignaturePad label="Tanda tangan Ibu" saved={false} onSave={vi.fn()} />);
    expect(screen.queryByText(/Tersimpan/)).not.toBeInTheDocument();
    expect(document.querySelector("svg[aria-hidden='true'] circle")).toBeNull();
  });

  it("renders the check fully drawn (static) under reduced motion", () => {
    stubMatchMedia(true);
    render(<SignaturePad label="Tanda tangan Ayah" saved onSave={vi.fn()} />);
    const svg = screen.getByText(/Tersimpan/).querySelector("svg") as SVGElement;
    expect(svg.querySelector("circle")?.getAttribute("style")).toBeNull();
    expect(svg.querySelector("path")?.getAttribute("style")).toBeNull();
  });
});
