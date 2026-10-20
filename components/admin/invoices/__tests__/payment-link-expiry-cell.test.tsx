import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentLinkExpiryCell } from "../payment-link-expiry-cell";

const NOW = new Date("2026-10-20T05:00:00.000Z");
const URL_ = "https://pay.example/x";
// 2026-10-22 07:30 UTC = 14.30 WIB
const FUTURE = "2026-10-22T07:30:00.000Z";
const PAST = "2026-10-19T07:30:00.000Z";

const cell = (inv: Parameters<typeof PaymentLinkExpiryCell>[0]["invoice"], variant?: "column" | "meta") =>
  render(<PaymentLinkExpiryCell invoice={inv} variant={variant} now={NOW} />);

describe("PaymentLinkExpiryCell", () => {
  it("active: date and time in WIB, tabular", () => {
    const { container } = cell({ status: "SENT", xenditPaymentUrl: URL_, paymentLinkExpiresAt: FUTURE });
    expect(container).toHaveTextContent("22 Okt 2026 · 14.30 WIB");
    expect(container.firstElementChild).toHaveClass("tabular-nums");
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
  });

  it.each(["SENT", "PARTIALLY_PAID", "OVERDUE"])("expired: red Kedaluwarsa for unpaid %s, with the old date", (status) => {
    const { container } = cell({ status, xenditPaymentUrl: URL_, paymentLinkExpiresAt: PAST });
    expect(screen.getByText("Kedaluwarsa")).toHaveClass("text-status-absent-text");
    expect(container).toHaveTextContent("19 Okt 2026 · 14.30 WIB");
  });

  it.each(["PAID", "CANCELLED"])("%s with a past stored date shows no red and no date", (status) => {
    const { container } = cell({ status, xenditPaymentUrl: URL_, paymentLinkExpiresAt: PAST });
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("—");
    expect(container).not.toHaveTextContent("WIB");
  });

  it("no link: em dash even with a stale date (D3)", () => {
    const { container } = cell({ status: "OVERDUE", xenditPaymentUrl: null, paymentLinkExpiresAt: PAST });
    expect(container).toHaveTextContent("—");
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
  });

  it("unrecorded: a link with no date reads 'Belum tercatat', never red", () => {
    const { container } = cell({ status: "SENT", xenditPaymentUrl: URL_, paymentLinkExpiresAt: null });
    expect(container).toHaveTextContent("Belum tercatat");
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
  });

  describe("meta variant (below md)", () => {
    it("active: prefixed with Link", () => {
      const { container } = cell({ status: "SENT", xenditPaymentUrl: URL_, paymentLinkExpiresAt: FUTURE }, "meta");
      expect(container).toHaveTextContent("Berlaku sampai 22 Okt 2026 · 14.30 WIB");
    });
    it("expired: red label", () => {
      cell({ status: "OVERDUE", xenditPaymentUrl: URL_, paymentLinkExpiresAt: PAST }, "meta");
      expect(screen.getByText("Kedaluwarsa")).toHaveClass("text-status-absent-text");
    });
    it("renders nothing when there is no link or the invoice is settled", () => {
      const a = cell({ status: "SENT", xenditPaymentUrl: null }, "meta");
      expect(a.container).toBeEmptyDOMElement();
      const b = cell({ status: "PAID", xenditPaymentUrl: URL_, paymentLinkExpiresAt: PAST }, "meta");
      expect(b.container).toBeEmptyDOMElement();
    });
  });
});
