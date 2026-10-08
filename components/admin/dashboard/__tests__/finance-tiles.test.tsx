import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { FinanceTiles } from "../finance-tiles";

describe("FinanceTiles (R2-ADMIN-3)", () => {
  it("shows overdue count and piutang, the overdue card pre-filtering the invoice list", () => {
    render(<FinanceTiles data={{ status: "ready", overdueCount: 16, receivable: 51650000 }} />);
    const overdue = screen.getByRole("link", { name: "16 tagihan lewat tempo" });
    expect(overdue).toHaveAttribute("href", "/admin/invoices?status=OVERDUE");
    expect(screen.getByText("Tagihan lewat tempo")).toBeVisible();
    expect(screen.getByText("Rp 51.650.000")).toBeVisible();
    expect(screen.getByRole("link", { name: /Total piutang/ })).toHaveAttribute("href", "/admin/invoices");
  });

  it("shows retry instead of zeros when the source is unavailable", () => {
    render(<FinanceTiles data={{ status: "unavailable" }} />);
    expect(screen.getByText("Ringkasan tagihan belum dapat dimuat.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  });
});
