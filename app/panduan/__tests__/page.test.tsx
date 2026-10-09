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

import PanduanPage from "../page";

describe("PanduanPage — who may open the tour", () => {
  beforeEach(() => {
    auth.session = null;
    window.history.replaceState(null, "", "/");
  });

  it("sends a signed-out visitor to the sign-in screen", async () => {
    await expect(PanduanPage()).rejects.toThrow("redirect:/");
  });

  it("sends a parent to their own portal, never rendering a slide", async () => {
    auth.session = { role: "GUARDIAN" };
    await expect(PanduanPage()).rejects.toThrow("redirect:/parent");
  });

  it.each([
    ["SUPER_ADMIN", "/admin"],
    ["SCHOOL_ADMIN", "/admin"],
    ["TEACHER", "/teacher"],
  ])("lets %s in and returns them to %s", async (role, home) => {
    auth.session = { role };
    const element = (await PanduanPage()) as ReactElement<{ homeHref: string; slides: unknown[] }>;
    expect(element.props.homeHref).toBe(home);
    expect(element.props.slides).toHaveLength(10);

    render(element);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Cara Talib bekerja/);
    expect(screen.getAllByRole("link", { name: /Kembali/ })[0]).toHaveAttribute("href", home);
  });
});
