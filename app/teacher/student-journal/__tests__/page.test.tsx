import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import PickerPage from "../page";

const oneClass = [
  { id: "ta-1", classSection: { id: "class-1", name: "DCARE", program: { name: "D'Care" } } },
];
const twoClasses = [
  ...oneClass,
  { id: "ta-2", classSection: { id: "class-2", name: "TKIT-A", program: { name: "TKIT" } } },
];

function mockAssignments(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: async () => data })),
  );
}

describe("StudentJournalPickerPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    nav.replace.mockClear();
    nav.push.mockClear();
    nav.params = new URLSearchParams();
  });

  it("routes a single-assignment teacher straight into today's grid", async () => {
    mockAssignments(oneClass);
    render(<PickerPage />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    const target = nav.replace.mock.calls[0][0] as string;
    expect(target).toContain("/teacher/student-journal/entry?classId=class-1");
    expect(target).toMatch(/date=\d{4}-\d{2}-\d{2}/);
  });

  it("keeps the form for a teacher who has a real choice to make", async () => {
    mockAssignments(twoClasses);
    render(<PickerPage />);

    expect(await screen.findByText("Pilih kelas dan tanggal")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("does not re-route when the guru asked for the picker on purpose", async () => {
    nav.params = new URLSearchParams("pick=1");
    mockAssignments(oneClass);
    render(<PickerPage />);

    expect(await screen.findByText("Pilih kelas dan tanggal")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("still shows the unassigned empty state rather than routing nowhere", async () => {
    mockAssignments([]);
    render(<PickerPage />);

    expect(await screen.findByText("Belum ditugaskan ke kelas")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("marks an emptied date inline, focuses it, and clears the error once a date is set", async () => {
    mockAssignments(twoClasses);
    render(<PickerPage />);
    const date = (await screen.findByLabelText("Tanggal")) as HTMLInputElement;
    expect(date).not.toHaveAttribute("aria-invalid");

    fireEvent.change(date, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Isi Buku Penghubung/ }));

    const error = await screen.findByText("Pilih tanggal dulu ya.");
    expect(error).toHaveAttribute("id", "journal-date-error");
    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(date).toHaveAttribute("aria-describedby", "journal-date-error");
    expect(date).toHaveFocus();
    expect(nav.push).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: "2026-08-03" } });
    expect(screen.queryByText("Pilih tanggal dulu ya.")).toBeNull();
    expect(date).not.toHaveAttribute("aria-invalid");
  });

  it("marks a missing class inline on the class control and clears it after picking one", async () => {
    // The picker preselects a class, so reach the "nothing picked" state with a
    // first assignment that has no class id.
    mockAssignments([
      { id: "ta-1", classSection: { id: "", name: "X", program: { name: "P" } } },
      { id: "ta-2", classSection: { id: "class-2", name: "TKIT-A", program: { name: "TKIT" } } },
    ]);
    nav.params = new URLSearchParams("pick=1");
    render(<PickerPage />);
    const trigger = await screen.findByRole("combobox", { name: "Kelas" });

    fireEvent.click(screen.getByRole("button", { name: /Isi Buku Penghubung/ }));

    expect(await screen.findByText("Pilih kelas dulu ya.")).toHaveAttribute("id", "journal-class-error");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-describedby", "journal-class-error");
    expect(trigger).toHaveFocus();
    expect(nav.push).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: /TKIT-A/ }));
    await waitFor(() => expect(screen.queryByText("Pilih kelas dulu ya.")).toBeNull());
    expect(trigger).not.toHaveAttribute("aria-invalid");
  });
});
