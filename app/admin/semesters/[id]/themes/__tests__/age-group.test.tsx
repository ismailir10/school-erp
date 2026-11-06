import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeCard } from "../client";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const base = { semesterId: "s1", order: 1, status: "ACTIVE", _count: { subThemes: 0 } };
const themes = [
  { ...base, id: "t1", name: "MPLS", ageGroup: null },
  { ...base, id: "t2", name: "Tema Alfa", ageGroup: "A" as const },
  { ...base, id: "t3", name: "Tema Beta", ageGroup: "B" as const },
];

function renderCard(list = themes) {
  return render(
    <ThemeCard themes={list} loading={false} canWrite selectedId={null} onSelect={vi.fn()} semesterId="s1" refresh={vi.fn().mockResolvedValue(undefined)} />,
  );
}

describe("theme kelompok", () => {
  it("renders a scope badge per theme", () => {
    renderCard();
    const badges = screen.getAllByTestId("theme-scope-badge").map((b) => b.textContent);
    expect(badges).toEqual(["Semua kelompok", "TK A", "TK B"]);
  });

  it("filters TK A to A + shared, TK B to B + shared, Semua to all", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "TK A" }));
    expect(screen.getByText("Tema Alfa")).toBeInTheDocument();
    expect(screen.getByText("MPLS")).toBeInTheDocument();
    expect(screen.queryByText("Tema Beta")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "TK B" }));
    expect(screen.getByText("Tema Beta")).toBeInTheDocument();
    expect(screen.getByText("MPLS")).toBeInTheDocument();
    expect(screen.queryByText("Tema Alfa")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Semua" }));
    expect(screen.getAllByTestId("theme-row")).toHaveLength(3);
  });

  it("shows an empty state when the filter matches nothing", async () => {
    const user = userEvent.setup();
    renderCard([themes[2]]);
    await user.click(screen.getByRole("button", { name: "TK A" }));
    expect(screen.getByText(/Belum ada tema untuk TK A/)).toBeInTheDocument();
  });

  it("sends ageGroup from the Kelompok select on create (default null) and edit", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();
    await user.click(screen.getByRole("button", { name: "Tambah" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Pilih TK A atau TK B bila tema hanya untuk satu kelompok.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Nama tema/), "Baru");
    await user.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ ageGroup: null });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(within(screen.getAllByTestId("theme-row")[0]).getByRole("button", { name: "Ubah tema" }));
    dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Kelompok"), "B");
    await user.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/themes/t1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toMatchObject({ ageGroup: "B" });
  });
});
