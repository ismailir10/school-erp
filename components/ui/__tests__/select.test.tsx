import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select"

function renderTrigger(ui: React.ReactElement) {
  render(ui)
  return screen.getByRole("combobox")
}

describe("<Select> auto-derived items", () => {
  it("renders the <SelectItem> label on the trigger when value matches (enum-style value)", () => {
    const trigger = renderTrigger(
      <Select value="TUITION">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TUITION">SPP Bulanan</SelectItem>
          <SelectItem value="REGISTRATION">Uang Pangkal</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(trigger.textContent).toContain("SPP Bulanan")
    expect(trigger.textContent).not.toContain("TUITION")
  })

  it("renders the label when options are produced via .map() (dynamic cuid-style value)", () => {
    const programs = [
      { id: "prog_abc123", name: "Day Care" },
      { id: "prog_xyz789", name: "TKIT A" },
    ]
    const trigger = renderTrigger(
      <Select value="prog_abc123">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {programs.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
    expect(trigger.textContent).toContain("Day Care")
    expect(trigger.textContent).not.toContain("prog_abc123")
  })

  it("walks into <SelectGroup> and conditional fragments", () => {
    const showExtra = true
    const trigger = renderTrigger(
      <Select value="y">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="x">X label</SelectItem>
            {showExtra && <SelectItem value="y">Y label</SelectItem>}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
    expect(trigger.textContent).toContain("Y label")
  })

  it("prefers child-derived items over an explicitly-passed items prop (F-3 fix)", () => {
    // F-3 from docs/runbooks/2026-05-16-staging-wipe-reseed-sweep.md:
    // ~12 callsites in the codebase pass BOTH a derived `items` array
    // AND SelectItem children with identical content. The previous
    // "items wins" behaviour caused base-ui to bind selection to the
    // items array while the popover rendered the children — the
    // persisted value drifted away from the clicked option.
    //
    // The wrapper now flips that: children are the visual source of
    // truth, so any SelectItem children win over a competing `items`
    // prop. The genuine items-only case (no children) still works,
    // covered by the other tests in this suite that pass children.
    const trigger = renderTrigger(
      <Select
        value="k"
        items={{ k: "Items Prop Label" }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="k">Child Label</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(trigger.textContent).toContain("Child Label")
    expect(trigger.textContent).not.toContain("Items Prop Label")
  })

  it("falls through to rendering the raw value when no matching <SelectItem> exists", () => {
    const trigger = renderTrigger(
      <Select value="unknown_id">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    )
    expect(trigger.textContent).toContain("unknown_id")
  })
})

describe("<SelectContent> placement", () => {
  it("does not align the popup over the trigger by default (opens below)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    render(
      <Select value="A">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="A">Alpha</SelectItem>
        </SelectContent>
      </Select>
    )
    await userEvent.click(screen.getByRole("combobox"))
    const popup = document.querySelector('[data-slot="select-content"]')
    expect(popup?.getAttribute("data-align-trigger")).toBe("false")
  })
})
