import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ContactActions } from "../contact-actions";

describe("ContactActions", () => {
  it("renders WhatsApp and Telepon when both numbers are usable", () => {
    render(<ContactActions phone="0812-8877-4402" whatsapp="0811 2233 4455" />);
    const wa = screen.getByRole("link", { name: "WhatsApp" });
    expect(wa).toHaveAttribute("href", "https://wa.me/6281122334455");
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "Telepon" })).toHaveAttribute("href", "tel:081288774402");
  });

  it("falls back to the phone for WhatsApp when there is no whatsapp number", () => {
    render(<ContactActions phone="0812-8877-4402" whatsapp={null} />);
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/6281288774402",
    );
    expect(screen.getByRole("link", { name: "Telepon" })).toBeInTheDocument();
  });

  it("falls back to the phone when the whatsapp number is unusable", () => {
    render(<ContactActions phone="0812-8877-4402" whatsapp="123" />);
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/6281288774402",
    );
  });

  it("renders only WhatsApp when only a whatsapp number exists", () => {
    render(<ContactActions phone={null} whatsapp="0812-8877-4402" />);
    expect(screen.getByRole("link", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Telepon" })).not.toBeInTheDocument();
  });

  it("renders nothing when neither number is usable", () => {
    const { container } = render(<ContactActions phone="12" whatsapp={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ContactActions phone={null} />);
    expect(c2).toBeEmptyDOMElement();
  });
});
