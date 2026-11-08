import { fireEvent, render, screen } from "@testing-library/react";
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
        { kind: "baru", audience: "guru", text: "Guru menandai semua hadir sekali ketuk." },
        { kind: "diperbaiki", audience: "orang-tua", text: "Orang tua melihat kehadiran hari ini." },
        { kind: "lebih-baik", audience: "semua", text: "Tampilan lebih rapi di ponsel kecil." },
      ],
    },
    {
      id: "2026-10-31",
      headline: "Khusus admin",
      items: [
        { kind: "baru", audience: "admin", text: "Admin mengekspor daftar tagihan." },
        { kind: "baru", audience: "admin", text: "Admin mencari siswa lebih cepat." },
      ],
    },
  ],
}));

import ChangelogPage from "../page";
import { ChangelogView } from "@/components/changelog/changelog-view";

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

  it("explains an empty view for a role with nothing yet", () => {
    render(<ChangelogView releases={[]} audience="guru" homeHref="/teacher" homeLabel="Beranda guru" />);
    expect(screen.getByText("Belum ada pembaruan untuk peran ini")).toBeInTheDocument();
  });
});
