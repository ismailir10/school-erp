import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LegalFooter } from "../legal-footer"

afterEach(cleanup)

describe("LegalFooter", () => {
  it("links to both legal pages and shows the current year", () => {
    render(<LegalFooter />)
    expect(screen.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms")
    expect(screen.getByRole("link", { name: "Kebijakan Privasi" })).toHaveAttribute("href", "/legal/privacy")
    expect(screen.getByText(`© ${new Date().getFullYear()} An Nisaa' Sekolahku`)).toBeInTheDocument()
  })

  it("keeps the dark-shell default unchanged (xs links, sidebar tone)", () => {
    render(<LegalFooter />)
    expect(screen.getByRole("contentinfo").className).toContain("text-sidebar-foreground/70")
    const link = screen.getByRole("link", { name: "Kebijakan Privasi" })
    expect(link.className).toContain("hover:text-white")
    expect(link.className).not.toContain("text-sm")
  })

  it("onLight steps links up to text-sm, darker, and keeps the 24px hit area", () => {
    render(<LegalFooter tone="onLight" className="mx-auto" />)
    const footer = screen.getByRole("contentinfo")
    expect(footer.className).toContain("text-muted-foreground")
    expect(footer.className).toContain("mx-auto")
    for (const name of ["Syarat & Ketentuan", "Kebijakan Privasi"]) {
      const link = screen.getByRole("link", { name })
      expect(link.className).toContain("text-sm")
      expect(link.className).toContain("text-foreground/80")
      expect(link.className).toContain("py-1.5")
      expect(link.className).not.toContain("hover:text-white")
    }
  })
})
