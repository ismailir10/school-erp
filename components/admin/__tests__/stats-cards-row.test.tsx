import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatsCardsRow } from "../stats-cards-row";

describe("<StatsCardsRow> phone grid", () => {
  it("spans an odd last card across both columns below lg", () => {
    const { container } = render(
      <StatsCardsRow cols={4}>
        <div />
        <div />
        <div />
      </StatsCardsRow>,
    );
    expect(container.firstElementChild).toHaveClass("grid-cols-2", "max-lg:[&>*:last-child:nth-child(odd)]:col-span-2");
  });
});
