import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentProblemsAlert } from "../payment-problems-alert";

const p = (message: string, i = 0) => ({ code: "OVERPAYMENT_FLAGGED", message, createdAt: `2026-10-21T0${i}:00:00.000Z` });

describe("PaymentProblemsAlert", () => {
  it("renders nothing when there are no problems", () => {
    const { container } = render(<PaymentProblemsAlert problems={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title and a single message without a list", () => {
    render(<PaymentProblemsAlert problems={[p("Ada pembayaran kedua di Xendit.")]} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Perlu dicek")).toBeInTheDocument();
    expect(screen.getByText(/Ada pembayaran kedua di Xendit\./)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists every message when there are several", () => {
    render(<PaymentProblemsAlert problems={[p("Pesan satu.", 1), p("Pesan dua.", 2)]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Pesan satu\./)).toBeInTheDocument();
    expect(screen.getByText(/Pesan dua\./)).toBeInTheDocument();
  });

  it("leads each line with the payment time in WIB, so equal amounts can be told apart", () => {
    render(<PaymentProblemsAlert problems={[p("Sama.", 1), p("Sama.", 2)]} />);
    const [first, second] = screen.getAllByRole("listitem");
    // 01:00Z and 02:00Z are 08.00 and 09.00 WIB.
    expect(first).toHaveTextContent(/^21 Okt 2026 · 08[.:]00 — Sama\.$/);
    expect(second).toHaveTextContent(/^21 Okt 2026 · 09[.:]00 — Sama\.$/);
  });
});
