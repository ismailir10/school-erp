import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClassDayGrid } from "@/components/student-journal/class-day-grid";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const categories = [
  {
    id: "cat-1",
    name: "Ibadah",
    order: 1,
    indicators: [
      { id: "ind-1", label: "Mengikuti doa pembuka", order: 1 },
      { id: "ind-2", label: "Mengikuti doa penutup", order: 2 },
    ],
  },
];

const abdullah = { id: "s1", name: "Abdullah Faris Siregar", nickname: "Abdullah" };

describe("ClassDayGrid — roster row identity", () => {
  it("uses two-letter initials instead of one repeated letter per row", () => {
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{}}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("AF")).toBeInTheDocument();
  });

  it("drops a nickname that is merely the first word of the name", () => {
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{}}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Abdullah Faris Siregar")).toBeInTheDocument();
    expect(screen.queryByText("Abdullah")).toBeNull();
  });

  it("keeps a nickname that says something the name does not", () => {
    render(
      <ClassDayGrid
        students={[{ id: "s2", name: "Muhammad Rizky Pratama", nickname: "Kiky" }]}
        categories={categories}
        state={{}}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Kiky")).toBeInTheDocument();
    expect(screen.getByText("MR")).toBeInTheDocument();
  });
});

describe("ClassDayGrid — bulk fill", () => {
  function expand() {
    fireEvent.click(screen.getByRole("button", { expanded: false }));
  }

  it("marks every indicator for a student in one gesture", () => {
    const onBulkSet = vi.fn();
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{}}
        onToggle={vi.fn()}
        onBulkSet={onBulkSet}
      />,
    );

    expand();
    fireEvent.click(screen.getByTestId("bulk-check-all"));
    expect(onBulkSet).toHaveBeenCalledWith("s1", true);
  });

  it("spends the mark-all control once the student is complete, leaving clear-all live", async () => {
    const onBulkSet = vi.fn();
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{ s1: { "ind-1": true, "ind-2": true } }}
        onToggle={vi.fn()}
        onBulkSet={onBulkSet}
      />,
    );

    expand();
    expect(screen.getByTestId("bulk-check-all")).toBeDisabled();
    fireEvent.click(screen.getByTestId("bulk-clear-all"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Hapus semua" }));
    await waitFor(() => expect(onBulkSet).toHaveBeenCalledWith("s1", false));
  });

  it("asks before clearing: Batal changes nothing, confirm runs the clear", async () => {
    const onBulkSet = vi.fn();
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{ s1: { "ind-1": true, "ind-2": false } }}
        onToggle={vi.fn()}
        onBulkSet={onBulkSet}
        visibleDate="2026-08-24"
      />,
    );

    expand();
    fireEvent.click(screen.getByTestId("bulk-clear-all"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Hapus semua tanda?");
    expect(dialog).toHaveTextContent("1 tanda Abdullah Faris Siregar pada 24 Agustus 2026 akan dihapus.");
    expect(onBulkSet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onBulkSet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("bulk-clear-all"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Hapus semua" }));
    await waitFor(() => expect(onBulkSet).toHaveBeenCalledWith("s1", false));
    expect(onBulkSet).toHaveBeenCalledTimes(1);
  });

  it("keeps mark-all one tap with no dialog", () => {
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{}}
        onToggle={vi.fn()}
        onBulkSet={vi.fn()}
      />,
    );
    expand();
    fireEvent.click(screen.getByTestId("bulk-check-all"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("renders no bulk controls for a caller that passes no handler", () => {
    render(
      <ClassDayGrid
        students={[abdullah]}
        categories={categories}
        state={{}}
        onToggle={vi.fn()}
      />,
    );

    expand();
    expect(screen.queryByTestId("bulk-check-all")).toBeNull();
    expect(screen.queryByTestId("bulk-clear-all")).toBeNull();
  });
});

describe("ClassDayGrid — lengkap avatar", () => {
  it("shows the done check once a single indicator is ticked, and initials while none is", () => {
    const { rerender } = render(
      <ClassDayGrid students={[abdullah]} categories={categories} state={{ s1: {} }} onToggle={vi.fn()} />,
    );
    expect(screen.getByText("AF")).toBeInTheDocument();
    rerender(
      <ClassDayGrid students={[abdullah]} categories={categories} state={{ s1: { "ind-1": true, "ind-2": false } }} onToggle={vi.fn()} />,
    );
    expect(screen.queryByText("AF")).toBeNull();
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });
});
