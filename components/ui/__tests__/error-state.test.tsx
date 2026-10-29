import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "../error-state";

describe("ErrorState", () => {
  it("renders the title and description inside a role=alert region", () => {
    render(<ErrorState title="Gagal memuat tagihan" description="Coba lagi sebentar ya." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Gagal memuat tagihan");
    expect(alert).toHaveTextContent("Coba lagi sebentar ya.");
  });

  it("renders a retry button that calls onRetry", async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Gagal" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("honours a custom retryLabel", () => {
    render(<ErrorState title="Gagal" onRetry={() => {}} retryLabel="Muat ulang" />);
    expect(screen.getByRole("button", { name: "Muat ulang" })).toBeInTheDocument();
  });

  it("renders no button without onRetry", () => {
    render(<ErrorState title="Gagal" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders extra actions passed as children", () => {
    render(
      <ErrorState title="Gagal">
        <a href="/parent">Kembali ke Beranda</a>
      </ErrorState>,
    );
    expect(screen.getByRole("link", { name: "Kembali ke Beranda" })).toBeInTheDocument();
  });
});
