import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const auth = vi.hoisted(() => ({ session: null as { role: string } | null }));

vi.mock("@/lib/auth", () => ({
  getSession: async () => auth.session,
  homePathForRole: (role: string) =>
    role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN"
      ? "/admin"
      : role === "TEACHER"
        ? "/teacher"
        : role === "GUARDIAN"
          ? "/parent"
          : "/",
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/lib/changelog/releases", () => ({
  RELEASES: [
    {
      id: "2026-11-06",
      headline: "Absensi lebih cepat",
      items: [
        { kind: "baru", audience: "guru", module: "kehadiran-siswa", text: "Guru menandai semua hadir sekali ketuk." },
        { kind: "diperbaiki", audience: "orang-tua", module: "kehadiran-siswa", text: "Orang tua melihat kehadiran hari ini." },
        { kind: "lebih-baik", audience: "semua", module: "umum", text: "Tampilan lebih rapi di ponsel kecil." },
      ],
    },
    {
      id: "2026-10-31",
      headline: "Khusus admin",
      items: [
        { kind: "baru", audience: "admin", module: "tagihan-pembayaran", text: "Admin mengekspor daftar tagihan." },
        { kind: "baru", audience: "admin", module: "siswa-wali", text: "Admin mencari siswa lebih cepat." },
      ],
    },
  ],
}));

import ChangelogPage from "../page";
import { ChangelogView } from "@/components/changelog/changelog-view";
import type { Release } from "@/lib/changelog/schema";

describe("ChangelogPage", () => {
  beforeEach(() => {
    auth.session = null;
  });

  it("sends a signed-out visitor to the sign-in screen", async () => {
    await expect(ChangelogPage()).rejects.toThrow("redirect:/");
  });

  it.each([
    ["GUARDIAN", "/parent", "Beranda orang tua"],
    ["SUPER_ADMIN", "/admin", "Dasbor admin"],
    ["SCHOOL_ADMIN", "/admin", "Dasbor admin"],
    ["TEACHER", "/teacher", "Beranda guru"],
  ])("lets %s in and links back to %s", async (role, home, label) => {
    auth.session = { role };
    render((await ChangelogPage()) as ReactElement);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Apa yang Baru");
    expect(screen.getByRole("link", { name: `Kembali ke ${label}` })).toHaveAttribute("href", home);
  });

  it("shows a teacher their items first, then everything on 'Semua'", async () => {
    auth.session = { role: "TEACHER" };
    render((await ChangelogPage()) as ReactElement);
    expect(screen.getByText("Guru menandai semua hadir sekali ketuk.")).toBeInTheDocument();
    expect(screen.getByText("Tampilan lebih rapi di ponsel kecil.")).toBeInTheDocument();
    expect(screen.queryByText("Orang tua melihat kehadiran hari ini.")).not.toBeInTheDocument();
    expect(screen.queryByText("Khusus admin")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    expect(screen.getByText("Orang tua melihat kehadiran hari ini.")).toBeInTheDocument();
    expect(screen.getByText("Khusus admin")).toBeInTheDocument();
  });

  it("goes back to the viewer's own items after widening", async () => {
    auth.session = { role: "GUARDIAN" };
    render((await ChangelogPage()) as ReactElement);
    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    expect(screen.getByText("Khusus admin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Untuk orang tua" }));
    expect(screen.getByText("Orang tua melihat kehadiran hari ini.")).toBeInTheDocument();
    expect(screen.queryByText("Khusus admin")).not.toBeInTheDocument();
  });

  it("keeps month and module selected when switching audiences", async () => {
    auth.session = { role: "TEACHER" };
    render((await ChangelogPage()) as ReactElement);

    const month = screen.getByRole("combobox", { name: "Bulan" });
    const module = screen.getByRole("combobox", { name: "Modul" });
    fireEvent.change(month, { target: { value: "2026-11" } });
    fireEvent.change(module, { target: { value: "kehadiran-siswa" } });

    expect(screen.getByText("Guru menandai semua hadir sekali ketuk.")).toBeInTheDocument();
    expect(within(screen.getByRole("article")).getByText("Kehadiran Siswa")).toBeInTheDocument();
    expect(screen.queryByText("Tampilan lebih rapi di ponsel kecil.")).not.toBeInTheDocument();
    expect(screen.queryByText("Orang tua melihat kehadiran hari ini.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    expect(month).toHaveValue("2026-11");
    expect(module).toHaveValue("kehadiran-siswa");
    expect(screen.getByText("Orang tua melihat kehadiran hari ini.")).toBeInTheDocument();
    expect(screen.queryByText("Khusus admin")).not.toBeInTheDocument();
  });

  it("clears empty filters while keeping the viewer's audience", async () => {
    auth.session = { role: "GUARDIAN" };
    render((await ChangelogPage()) as ReactElement);

    const month = screen.getByRole("combobox", { name: "Bulan" });
    const module = screen.getByRole("combobox", { name: "Modul" });
    fireEvent.change(month, { target: { value: "2026-10" } });
    fireEvent.change(module, { target: { value: "tagihan-pembayaran" } });
    expect(screen.getByText("Tidak ada pembaruan yang cocok")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hapus filter" }));

    expect(month).toHaveValue("");
    expect(module).toHaveValue("");
    expect(screen.getByRole("button", { name: "Untuk orang tua" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Orang tua melihat kehadiran hari ini.")).toBeInTheDocument();
    expect(screen.queryByText("Khusus admin")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Halaman pembaruan" })).not.toBeInTheDocument();
  });

  it("focuses the new page results and returns to page one after a filter change", () => {
    const releases: Release[] = Array.from({ length: 6 }, (_, index) => ({
      id: `2026-11-0${6 - index}`,
      headline: `Rilis ${index + 1}`,
      items: [{ kind: "baru", audience: "semua", module: "umum", text: "Pembaruan Talib." }],
    }));
    render(<ChangelogView releases={releases} audience="admin" homeHref="/admin" homeLabel="Dasbor admin" />);

    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Sebelumnya" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));

    expect(screen.getByText("Halaman 2 dari 2")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Rilis 6" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Berikutnya" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Modul" }), { target: { value: "umum" } });
    expect(screen.getByText("Halaman 1 dari 2")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });

  it("explains an empty view for a role with nothing yet", () => {
    render(<ChangelogView releases={[]} audience="guru" homeHref="/teacher" homeLabel="Beranda guru" />);
    expect(screen.getByText("Belum ada pembaruan untuk peran ini")).toBeInTheDocument();
  });
});
