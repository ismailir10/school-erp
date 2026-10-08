import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DetailPageHeader } from "@/components/admin/detail-page-header";

// T3 (cycle 2026-09-26, admin-ui-standard) — DetailPageHeader's structured
// `primaryActions` / `menuActions` API: at most two visible buttons, the
// rest behind a `⋯` overflow menu, destructive entries last.
describe("DetailPageHeader", () => {
  it("renders backHref, title and description with no actions", () => {
    render(<DetailPageHeader backHref="/admin/students" title="Alya Putri" description="TK B" />);

    expect(screen.getByRole("link", { name: /Kembali/ })).toHaveAttribute("href", "/admin/students");
    expect(screen.getByRole("heading", { name: "Alya Putri" })).toBeInTheDocument();
    expect(screen.getByText("TK B")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders at most two primary actions as visible buttons, dropping the rest", () => {
    const onA = vi.fn();
    render(
      <DetailPageHeader
        backHref="/admin/students"
        title="Alya Putri"
        primaryActions={[
          { label: "Ubah", onClick: onA },
          { label: "Daftarkan ke Kelas", onClick: vi.fn() },
          { label: "Naik Kelas", onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Ubah" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Naik Kelas" })).not.toBeInTheDocument();
  });

  it("puts menuActions behind a ⋯ overflow trigger labelled 'Aksi lainnya'", async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn();
    render(
      <DetailPageHeader
        backHref="/admin/students"
        title="Alya Putri"
        primaryActions={[{ label: "Ubah", onClick: vi.fn() }]}
        menuActions={[
          { label: "Naik Kelas", onClick: vi.fn() },
          { label: "Keluarkan", onClick: onWithdraw, destructive: true },
        ]}
      />,
    );

    expect(screen.queryByText("Naik Kelas")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));

    const menuItem = await screen.findByText("Naik Kelas");
    expect(menuItem).toBeInTheDocument();

    const destructiveItem = screen.getByText("Keluarkan");
    await user.click(destructiveItem);
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });

  it("sizes the overflow menu to its content so long labels do not wrap word by word", async () => {
    const user = userEvent.setup();
    render(
      <DetailPageHeader
        backHref="/admin/enrollments"
        title="Aisyah"
        menuActions={[{ label: "Lanjutkan ke Jadwalkan Kunjungan", onClick: vi.fn() }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("w-auto", "min-w-40");
    expect(menu).not.toHaveClass("w-(--anchor-width)");
  });

  it("orders destructive menu items last, after a separator", async () => {
    const user = userEvent.setup();
    render(
      <DetailPageHeader
        backHref="/admin/classes"
        title="TKIT B"
        menuActions={[
          { label: "Nonaktifkan", onClick: vi.fn(), destructive: true },
          { label: "Naik Kelas", onClick: vi.fn() },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Naik Kelas", "Nonaktifkan"]);
    expect(items[1]).toHaveAttribute("data-variant", "destructive");
    expect(items[0]).toHaveAttribute("data-variant", "default");
  });

  it("drops hidden actions from both slots without affecting the 2-visible cap", () => {
    render(
      <DetailPageHeader
        backHref="/admin/students"
        title="Alya Putri"
        primaryActions={[
          { label: "Ubah", onClick: vi.fn(), hidden: true },
          { label: "Daftarkan ke Kelas", onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Ubah" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
  });

  it("still supports the legacy ReactNode actions slot", () => {
    render(
      <DetailPageHeader backHref="/admin/guardians" title="Budi Santoso" actions={<button>Ubah</button>} />,
    );

    expect(screen.getByRole("button", { name: "Ubah" })).toBeInTheDocument();
  });

  it("renders a primaryAction's variant and forwards testId to data-testid", () => {
    render(
      <DetailPageHeader
        backHref="/admin/invoices"
        title="INV-001"
        primaryActions={[
          { label: "Catat Pembayaran", onClick: vi.fn(), variant: "default", testId: "invoice-record-payment-btn" },
        ]}
      />,
    );

    const button = screen.getByTestId("invoice-record-payment-btn");
    expect(button).toHaveAccessibleName("Catat Pembayaran");
    // base-nova's Button applies variant classes via CVA — "outline" is the
    // one distinguishing class a filled ("default") button must NOT carry.
    expect(button.className).not.toMatch(/\bborder-border\b/);
  });

  it("renders no overflow trigger when menuActions is empty", () => {
    render(
      <DetailPageHeader
        backHref="/admin/students"
        title="Alya Putri"
        primaryActions={[{ label: "Ubah", onClick: vi.fn() }]}
        menuActions={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Aksi lainnya" })).not.toBeInTheDocument();
  });
});
