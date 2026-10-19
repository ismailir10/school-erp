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
});
