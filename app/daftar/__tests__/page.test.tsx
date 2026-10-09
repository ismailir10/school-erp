import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { program: { findMany: mocks.findMany } } }));
vi.mock("../client", () => ({
  default: ({ programs }: { programs: { id: string; name: string }[] }) => (
    <div data-testid="daftar-client">{programs.length}</div>
  ),
}));

import DaftarPage from "../page";

describe("/daftar page chrome", () => {
  it("renders the school logo, heading and legal footer", async () => {
    mocks.findMany.mockResolvedValue([{ id: "program_1", name: "PAUD" }]);
    const { container } = render(await DaftarPage());

    expect(
      screen.getByRole("heading", { name: "Pendaftaran Siswa Baru" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("daftar-client")).toHaveTextContent("1");

    // Decorative logo (alt="") — the wordmark beside it names the school.
    const logo = container.querySelector("img");
    expect(logo).not.toBeNull();
    expect(decodeURIComponent(logo!.getAttribute("src") ?? "")).toContain("/logo.png");
    expect(logo).toHaveAttribute("alt", "");

    expect(screen.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    expect(screen.getByRole("link", { name: "Kebijakan Privasi" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    expect(screen.getByText(/©\s*\d{4}\s*An Nisaa/)).toBeInTheDocument();
  });

  it("shows the school hero above the title and the gallery after the form", async () => {
    mocks.findMany.mockResolvedValue([{ id: "program_1", name: "PAUD" }]);
    render(await DaftarPage());

    const hero = screen.getByRole("img", { name: /para guru/i });
    const title = screen.getByRole("heading", { name: "Pendaftaran Siswa Baru" });
    const form = screen.getByTestId("daftar-client");
    const gallery = screen.getByRole("heading", { name: /Sekilas kegiatan/ });
    const footer = screen.getByRole("link", { name: "Kebijakan Privasi" });

    const before = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(hero.compareDocumentPosition(title) & before).toBeTruthy();
    expect(title.compareDocumentPosition(form) & before).toBeTruthy();
    expect(form.compareDocumentPosition(gallery) & before).toBeTruthy();
    expect(gallery.compareDocumentPosition(footer) & before).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("still renders the footer when the program lookup fails", async () => {
    mocks.findMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await DaftarPage());
    expect(screen.getByRole("link", { name: "Kebijakan Privasi" })).toBeInTheDocument();
  });
});
