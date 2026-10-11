import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConvertDuplicateConfirm, ConvertGuardianConfirm } from "../enrollment-convert-confirm";

describe("ConvertDuplicateConfirm", () => {
  const candidates = [
    { id: "stu-1", name: "Aisyah Putri", dateOfBirth: "2021-03-04", guardianNames: ["Budi Santoso", "Dewi Lestari"] },
    { id: "stu-2", name: "Aisyah Putri", dateOfBirth: null, guardianNames: [] },
  ];

  it("renders nothing while closed", () => {
    render(<ConvertDuplicateConfirm candidates={null} childName="Aisyah" onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("lists each candidate in a labelled list, with a new-tab link to the student", () => {
    render(<ConvertDuplicateConfirm candidates={candidates} childName="Aisyah" onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog", { name: "Sudah ada siswa dengan data mirip" });
    const items = within(within(dialog).getByRole("list", { name: "Siswa dengan data mirip" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(/Wali: Budi Santoso, Dewi Lestari/)).toBeInTheDocument();
    expect(within(items[1]).getByText("Tanggal lahir belum diisi")).toBeInTheDocument();
    const link = within(items[0]).getByRole("link", { name: "Lihat siswa Aisyah Putri, tab baru" });
    expect(link).toHaveAttribute("href", "/admin/students/stu-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("names the child in the description and falls back when the name is blank", () => {
    const { rerender } = render(
      <ConvertDuplicateConfirm candidates={candidates} childName="Aisyah" onConfirm={vi.fn()} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText(/supaya Aisyah tidak terdaftar dua kali/)).toBeInTheDocument();
    rerender(<ConvertDuplicateConfirm candidates={candidates} childName="" onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    expect(screen.getByText(/supaya anak ini tidak terdaftar dua kali/)).toBeInTheDocument();
  });

  it("Tetap jadikan siswa confirms; Batal only asks to close", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ConvertDuplicateConfirm candidates={candidates} childName="Aisyah" onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("alertdialog");

    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0][0]).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Tetap jadikan siswa" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("opens with focus on Batal, not on the first candidate link", async () => {
    render(<ConvertDuplicateConfirm candidates={candidates} childName="Aisyah" onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    const batal = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Batal" });
    await vi.waitFor(() => expect(document.activeElement).toBe(batal));
  });

  it("makes the list keyboard-scrollable and height-capped so the buttons stay reachable", () => {
    render(<ConvertDuplicateConfirm candidates={candidates} childName="Aisyah" onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Siswa dengan data mirip" });
    expect(list).toHaveAttribute("tabindex", "0");
    expect(list.className).toContain("max-h-[40dvh]");
    expect(list.className).toContain("overflow-y-auto");
  });
});

describe("ConvertGuardianConfirm", () => {
  const guardians = [
    { role: "AYAH" as const, formName: "Budi S.", existingName: "Budi Santoso", otherChildrenCount: 0 },
    { role: "IBU" as const, formName: "Dewi L.", existingName: "Dewi Lestari", otherChildrenCount: 3 },
  ];

  it("shows the form name and the registered name side by side for each wali", () => {
    render(<ConvertGuardianConfirm guardians={guardians} onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog", { name: "Email ini sudah terdaftar atas nama lain" });
    const items = within(within(dialog).getByRole("list", { name: "Wali dengan nama berbeda" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ayah");
    expect(items[0]).toHaveTextContent("Di formulir: Budi S.");
    expect(items[0]).toHaveTextContent("Di data wali: Budi Santoso");
    expect(items[0]).not.toHaveTextContent("anak lain");
    expect(items[1]).toHaveTextContent("Ibu");
    expect(items[1]).toHaveTextContent("Sudah tertaut ke 3 anak lain.");
  });

  it("opens with focus on Batal and the list is keyboard-scrollable", async () => {
    render(<ConvertGuardianConfirm guardians={guardians} onConfirm={vi.fn()} onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog");
    const batal = within(dialog).getByRole("button", { name: "Batal" });
    await vi.waitFor(() => expect(document.activeElement).toBe(batal));
    const list = within(dialog).getByRole("list", { name: "Wali dengan nama berbeda" });
    expect(list).toHaveAttribute("tabindex", "0");
    expect(list.className).toContain("max-h-[40dvh]");
  });

  it("Tetap tautkan confirms; Batal only asks to close", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ConvertGuardianConfirm guardians={guardians} onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("alertdialog");

    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0][0]).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Tetap tautkan" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
