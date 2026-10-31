import { render, screen } from "@testing-library/react";
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

import PanduanOrangTuaPage from "../page";

describe("PanduanOrangTuaPage — who may open the parent tour", () => {
  beforeEach(() => {
    auth.session = null;
    window.history.replaceState(null, "", "/");
  });

  it("sends a signed-out visitor to the sign-in screen", async () => {
    await expect(PanduanOrangTuaPage()).rejects.toThrow("redirect:/");
  });

  it.each([
    ["GUARDIAN", "/parent", "Beranda orang tua"],
    ["SUPER_ADMIN", "/admin", "Dasbor admin"],
    ["SCHOOL_ADMIN", "/admin", "Dasbor admin"],
    ["TEACHER", "/teacher", "Beranda guru"],
  ])("lets %s in and returns them to %s", async (role, home, label) => {
    auth.session = { role };
    const element = (await PanduanOrangTuaPage()) as ReactElement<{ homeHref: string; title: string }>;
    expect(element.props.homeHref).toBe(home);
    expect(element.props.title).toBe("Panduan orang tua");

    render(element);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Bapak dan Ibu/);
    expect(screen.getByRole("link", { name: `Kembali ke ${label}` })).toHaveAttribute("href", home);
  });
});
