/**
 * The header carries one visible action chosen by the child's state; "Edit"
 * lives in Data Anak. Guards stay as they were: Naik Kelas needs a current
 * class, Luluskan any ACTIVE enrolment, and a withdrawn or graduated child is
 * never offered Daftarkan ke Kelas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";
import { CLASS_ENROLLMENT, ResizeObserverStub, makeStudent, stubFetch } from "./student-fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

async function renderStudent(over: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", stubFetch({ student: makeStudent(over) }).fn);
  render(<StudentDetailPage />);
  await screen.findByRole("heading", { level: 1, name: "Aisyah Putri" });
}

/** Everything the header shows as a button (the ⋯ trigger included), by name. */
function headerButtons(): string[] {
  const title = screen.getByRole("heading", { level: 1 });
  const header = title.closest("div.mb-section") as HTMLElement;
  return within(header)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

async function menuLabels(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
  return (await screen.findAllByRole("menuitem")).map((m) => m.textContent ?? "");
}

describe("student header — action by state", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("ACTIVE and placed: no visible button; the ⋯ menu has the four actions, Keluarkan last", async () => {
    const user = userEvent.setup();
    await renderStudent();
    expect(headerButtons()).toEqual(["Aksi lainnya"]);
    expect(await menuLabels(user)).toEqual(["Daftarkan ke Kelas", "Naik Kelas", "Luluskan", "Keluarkan"]);
  });

  it("ACTIVE and placed: the menu's Daftarkan ke Kelas adds a placement", async () => {
    const user = userEvent.setup();
    await renderStudent();
    await menuLabels(user);
    await user.click(screen.getByRole("menuitem", { name: "Daftarkan ke Kelas" }));
    expect(await screen.findByRole("dialog", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
  });

  it("ACTIVE and unplaced: Daftarkan ke Kelas is the only visible action, and filled", async () => {
    const user = userEvent.setup();
    await renderStudent({ enrollments: [] });
    expect(headerButtons()).toEqual(["Daftarkan ke Kelas", "Aksi lainnya"]);
    expect(screen.getByRole("button", { name: "Daftarkan ke Kelas" }).className).toContain("bg-primary");
    // Not repeated in the menu; Naik Kelas and Luluskan have nothing to act on.
    expect(await menuLabels(user)).toEqual(["Keluarkan"]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Daftarkan ke Kelas" }));
    expect(await screen.findByRole("dialog", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
  });

  it("ACTIVE with only a stale ACTIVE row in an archived year counts as unplaced", async () => {
    const stale = {
      ...CLASS_ENROLLMENT,
      classSection: { ...CLASS_ENROLLMENT.classSection, academicYear: { name: "2024/2025", status: "ARCHIVED" } },
    };
    const user = userEvent.setup();
    await renderStudent({ enrollments: [stale] });
    expect(screen.getByRole("button", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
    // Luluskan still follows the server's looser "any ACTIVE row" rule.
    expect(await menuLabels(user)).toEqual(["Luluskan", "Keluarkan"]);
  });

  it.each([
    ["WITHDRAWN", { status: "WITHDRAWN", enrollments: [] }],
    ["GRADUATED", { status: "GRADUATED", graduationDate: "2026-06-30", enrollments: [] }],
  ])("%s: only Aktifkan kembali, no Daftarkan ke Kelas anywhere and no menu", async (_label, over) => {
    await renderStudent(over);
    expect(headerButtons()).toEqual(["Aktifkan kembali"]);
    expect(screen.queryByRole("button", { name: "Aksi lainnya" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Daftarkan ke Kelas" })).not.toBeInTheDocument();
  });

  it("without edit rights the header has no actions at all", async () => {
    await renderStudent({ canEdit: false, enrollments: [] });
    expect(screen.queryByRole("button", { name: "Daftarkan ke Kelas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aksi lainnya" })).not.toBeInTheDocument();
  });

  it("the header no longer has an Edit button", async () => {
    await renderStudent();
    expect(headerButtons()).not.toContain("Edit");
  });
});

describe("Edit sits in Data Anak", () => {
  beforeEach(() => {
    toastError.mockClear();
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("shows Edit in the Data Anak header", async () => {
    await renderStudent();
    const dataAnak = document.getElementById("data-anak")!;
    expect(within(dataAnak).getByRole("button", { name: "Edit data anak" })).toHaveTextContent("Edit");
  });

  it("hides Edit from staff who cannot edit", async () => {
    await renderStudent({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Edit data anak" })).not.toBeInTheDocument();
  });

  it("moves focus into the first field when editing starts and back to Edit after Batal", async () => {
    const user = userEvent.setup();
    await renderStudent();
    await user.click(screen.getByRole("button", { name: "Edit data anak" }));

    const name = await screen.findByLabelText(/Nama Lengkap/);
    expect(name).toHaveFocus();
    // Edit gives way to Batal / Simpan Perubahan inside the same section header.
    const dataAnak = document.getElementById("data-anak")!;
    expect(within(dataAnak).queryByRole("button", { name: "Edit data anak" })).not.toBeInTheDocument();
    expect(within(dataAnak).getByRole("button", { name: "Simpan Perubahan" })).toBeInTheDocument();

    await user.click(within(dataAnak).getByRole("button", { name: "Batal" }));
    expect(await screen.findByRole("button", { name: "Edit data anak" })).toHaveFocus();
  });

  it("refuses to start while Informasi Tambahan holds unsaved rows, with the existing toast", async () => {
    const user = userEvent.setup();
    await renderStudent();
    await user.click(screen.getByRole("button", { name: "Tambah Field" }));
    await user.type(screen.getAllByLabelText("Nama field")[0], "Hobi");

    await user.click(screen.getByRole("button", { name: "Edit data anak" }));

    expect(toastError).toHaveBeenCalledWith("Simpan informasi tambahan dulu sebelum mengedit data siswa.");
    expect(screen.queryByRole("button", { name: "Simpan Perubahan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit data anak" })).toBeInTheDocument();
  });
});
