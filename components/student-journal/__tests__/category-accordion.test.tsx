import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CategoryAccordion } from "@/components/student-journal/category-accordion";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
  },
}));

describe("CategoryAccordion deactivation confirmation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the confirmation open after failure and allows retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Kategori masih digunakan" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CategoryAccordion
        categories={[
          {
            id: "category-1",
            name: "Ibadah",
            scope: "SCHOOL",
            order: 1,
            status: "ACTIVE",
            indicators: [],
          },
        ]}
        loading={false}
        onRefresh={vi.fn()}
        onEditCategory={vi.fn()}
        onAddIndicator={vi.fn()}
        onEditIndicator={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buka menu kategori" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Nonaktifkan" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, Nonaktifkan" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Kategori masih digunakan",
        expect.objectContaining({ duration: Infinity, action: expect.objectContaining({ label: "Coba lagi" }) }),
      );
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Ya, Nonaktifkan" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Ya, Nonaktifkan" }));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Kategori diperbarui", expect.anything());
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Ya, Nonaktifkan" }),
      ).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
