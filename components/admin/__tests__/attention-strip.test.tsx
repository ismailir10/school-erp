import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AttentionStrip } from "../attention-strip";

describe("AttentionStrip", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<AttentionStrip items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled region with the heading and the item count", () => {
    render(
      <AttentionStrip
        items={[
          { id: "a", message: "Piutang Rp 1.000.000" },
          { id: "b", message: "KK belum ada" },
        ]}
      />,
    );
    const region = screen.getByRole("region", { name: "Perlu perhatian" });
    expect(within(region).getByRole("heading", { name: "Perlu perhatian" })).toBeInTheDocument();
    expect(within(region).getByText("2")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(within(region).getByText("Piutang Rp 1.000.000")).toBeInTheDocument();
  });

  it("renders an href action as a link", () => {
    render(
      <AttentionStrip
        items={[
          {
            id: "a",
            message: "Belum ada anak",
            action: { label: "Tautkan anak", href: "/admin/students", testId: "go" },
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "Tautkan anak" });
    expect(link).toHaveAttribute("href", "/admin/students");
    expect(link).toHaveAttribute("data-testid", "go");
  });

  it("renders an onClick action as a button that fires", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <AttentionStrip
        items={[{ id: "a", message: "Piutang", action: { label: "Ingatkan via WhatsApp", onClick } }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ingatkan via WhatsApp" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders an item without an action as message only", () => {
    render(<AttentionStrip items={[{ id: "a", message: "KTP belum ada" }]} />);
    expect(screen.getByText("KTP belum ada")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a secondary action beside the primary one and fires each separately", async () => {
    const user = userEvent.setup();
    const primary = vi.fn();
    const secondary = vi.fn();
    render(
      <AttentionStrip
        items={[
          {
            id: "a",
            message: "Piutang",
            action: { label: "Lihat tagihan", onClick: primary },
            secondaryAction: { label: "Ingatkan via WhatsApp", onClick: secondary, testId: "remind" },
          },
        ]}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Lihat tagihan", "Ingatkan via WhatsApp"]);
    expect(screen.getByTestId("remind")).toBe(buttons[1]);

    await user.click(buttons[1]);
    expect(secondary).toHaveBeenCalledTimes(1);
    expect(primary).not.toHaveBeenCalled();
    await user.click(buttons[0]);
    expect(primary).toHaveBeenCalledTimes(1);
  });

  it("renders a lone secondary action when there is no primary one", () => {
    render(
      <AttentionStrip
        items={[{ id: "a", message: "Piutang", secondaryAction: { label: "Ingatkan", onClick: vi.fn() } }]}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
