import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const payrollItemFindFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { payrollItem: { findFirst: payrollItemFindFirst } } }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import { getSession } from "@/lib/auth";
import SlipDetailPage from "../page";

const slip = {
  id: "slip-1", grossAmount: 2000000, deductions: 100000, netAmount: 1900000,
  employee: { id: "employee-1", nama: "Bu Sari", formalName: null, kode: "G-01", jabatan: "Guru", bankName: null, bankAccountNo: null },
  payrollRun: { id: "run-1", periodStart: "2026-03-01", periodEnd: "2026-03-31", actualWorkDays: 20, status: "APPROVED", tenantId: "tenant-1" },
  lines: [
    { id: "income", labelSnapshot: "Tunjangan pengembangan kompetensi dan pembelajaran yang sangat panjang", categorySnapshot: "INCOME", finalAmount: 2000000 },
    { id: "deduction", labelSnapshot: "Potongan koperasi dengan nama program yang sangat panjang", categorySnapshot: "DEDUCTION", finalAmount: 100000 },
  ],
};

describe("SlipDetailPage", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockResolvedValue({ role: "TEACHER", tenantId: "tenant-1", employeeId: "employee-1" } as never);
    payrollItemFindFirst.mockResolvedValue(slip);
  });

  afterEach(() => vi.useRealTimers());

  it("uses the shared header with a deterministic accessible back and PDF action", async () => {
    render(await SlipDetailPage({ params: Promise.resolve({ id: "slip-1" }) }));
    expect(screen.getByRole("heading", { name: "Maret 2026" })).toBeInTheDocument();
    expect(screen.getByText("1 Maret – 31 Maret 2026")).toBeInTheDocument();
    const back = screen.getByRole("link", { name: /Kembali ke slip gaji/ });
    expect(back).toHaveAttribute("href", "/teacher/slips");
    expect(back).toHaveClass("min-h-11", "focus-visible:ring-2");
    const pdf = screen.getByRole("link", { name: /Unduh PDF slip/ });
    expect(pdf).toHaveAttribute("href", "/api/slips/slip-1/pdf");
    expect(pdf).toHaveAttribute("target", "_blank");
    expect(pdf).toHaveClass("min-h-11", "focus-visible:ring-2");
  });

  it("names a 21–20 cycle by its end month and prints the range without ISO dates", async () => {
    payrollItemFindFirst.mockResolvedValue({
      ...slip,
      payrollRun: { ...slip.payrollRun, periodStart: "2026-08-21", periodEnd: "2026-09-20" },
    });
    render(await SlipDetailPage({ params: Promise.resolve({ id: "slip-1" }) }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    expect(screen.getByText("21 Agustus – 20 September 2026")).toBeInTheDocument();
    expect(screen.queryByText(/s\/d/)).toBeNull();
  });

  it("names the product Talib in the footer", async () => {
    render(await SlipDetailPage({ params: Promise.resolve({ id: "slip-1" }) }));
    expect(screen.getByText(/Talib by An Nisaa' Sekolahku/)).toBeInTheDocument();
    expect(screen.queryByText(/An Nisaa' ERP/)).toBeNull();
  });

  it("keeps long salary labels flexible while keeping amounts readable", async () => {
    render(await SlipDetailPage({ params: Promise.resolve({ id: "slip-1" }) }));
    const label = screen.getByText(/Tunjangan pengembangan/);
    expect(label).toHaveClass("min-w-0", "flex-1", "break-words");
    const amount = screen.getAllByText(/Rp 2.000.000/)[0];
    expect(amount).toHaveClass("shrink-0", "whitespace-nowrap", "tabular-nums");
  });

  it("prints the Jakarta calendar date when it has already advanced past the UTC date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T17:30:00.000Z"));
    render(await SlipDetailPage({ params: Promise.resolve({ id: "slip-1" }) }));

    expect(screen.getByText("Tanggal cetak: 2 Maret 2026")).toBeInTheDocument();
  });
});
