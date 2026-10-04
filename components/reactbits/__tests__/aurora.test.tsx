import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { Aurora } from "../aurora"

describe("Aurora", () => {
  it("is a decorative, non-interactive layer behind its host's content", () => {
    const { container } = render(<Aurora />)
    const layer = container.querySelector<HTMLElement>('[data-slot="aurora"]')!
    expect(layer).toHaveAttribute("aria-hidden", "true")
    expect(layer.className).toContain("pointer-events-none")
    expect(layer.className).toContain("-z-10")
    expect(layer.textContent).toBe("")
  })

  it("renders three bands, each animated only under motion-safe", () => {
    const { container } = render(<Aurora />)
    const bands = container.querySelectorAll<HTMLElement>("[data-band]")
    expect(bands).toHaveLength(3)
    for (const band of bands) {
      expect(band.className).toMatch(/motion-safe:animate-aurora-[abc]/)
      // No bare `animate-aurora-*`: reduced-motion users get a static backdrop.
      expect(band.className).not.toMatch(/(^|\s)animate-aurora/)
    }
  })

  it("uses brand tokens and curves only: no hex, no SVG shapes", () => {
    const { container } = render(<Aurora />)
    expect(container.querySelector("svg, polygon, path")).toBeNull()
    for (const band of container.querySelectorAll<HTMLElement>("[data-band]")) {
      const style = band.getAttribute("style") ?? ""
      expect(style).toContain("var(--")
      expect(style).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(band.className).toContain("rounded-[50%]")
    }
  })

  it("merges a caller className onto the layer", () => {
    const { container } = render(<Aurora className="opacity-80" />)
    expect(container.querySelector('[data-slot="aurora"]')!.className).toContain("opacity-80")
  })
})
