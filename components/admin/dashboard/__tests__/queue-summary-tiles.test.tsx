import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { QueueSummaryTiles } from "../queue-summary-tiles";

describe("QueueSummaryTiles", () => {
  it("renders one tile per visible source with a count and a ?kind= link", () => {
    render(<QueueSummaryTiles items={[
      { kind: "enrollment", status: "ready", count: 3 },
      { kind: "invoice", status: "ready", count: 5 },
    ]} />);
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("Formulir menunggu tinjauan")).toBeVisible();
    expect(screen.getByRole("link", { name: "5 Link pembayaran belum tersedia" })).toHaveAttribute("href", "/admin/work-queue?kind=invoice");
  });

  it("surfaces new admission inquiries with a link to the filtered queue (X-6)", () => {
    render(<QueueSummaryTiles items={[{ kind: "inquiry", status: "ready", count: 2 }]} />);
    expect(screen.getByRole("link", { name: "2 Pertanyaan pendaftaran baru" })).toHaveAttribute("href", "/admin/work-queue?kind=inquiry");
  });

  it("shows a retry affordance instead of a false zero for an unavailable source", () => {
    render(<QueueSummaryTiles items={[{ kind: "payroll", status: "unavailable", count: 0 }]} />);
    expect(screen.getByText("—")).toBeVisible();
    expect(screen.getByText("Belum dapat dimuat.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeVisible();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows one calm line instead of tiles when every visible source is ready and empty", () => {
    render(<QueueSummaryTiles items={[
      { kind: "enrollment", status: "ready", count: 0 },
      { kind: "leave", status: "ready", count: 0 },
    ]} />);
    expect(screen.getByText("Semua beres — tidak ada pekerjaan yang menunggu.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing when no source is visible to this admin", () => {
    const { container } = render(<QueueSummaryTiles items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});


it("keeps empty categories out of the way when other work is pending, but preserves failures", () => {
  render(<QueueSummaryTiles items={[
    { kind: "enrollment", status: "ready", count: 0 },
    { kind: "leave", status: "ready", count: 2 },
    { kind: "invoice", status: "unavailable", count: 0 },
  ]} />);
  expect(screen.queryByRole("link", { name: /0 Formulir/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2 Pengajuan cuti menunggu" })).toBeInTheDocument();
  expect(screen.getByText("Link pembayaran belum tersedia")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
});
