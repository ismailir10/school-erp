import { MESSAGES } from "@/lib/feedback";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemesClient } from "../themes/client";

vi.mock("@/components/ui/date-picker", () => ({ DatePicker: ({ value, onChange, ...props }: { value: string; onChange: (value: string) => void }) => <input {...props} value={value} onChange={(event) => onChange(event.target.value)} /> }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
const semester = { id: "s1", number: 1 as const, academicYearName: "2026/2027", startDate: "2026-07-01", endDate: "2026-12-31", status: "ACTIVE" };
beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("curriculum interrupted saves", () => {
  it.each(["theme", "subtheme", "week"])("retains the %s draft and enables retry after network failure", async (kind) => {
    const user = userEvent.setup();
    let fail = true;
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes++;
        if (fail) throw new TypeError("Failed to fetch");
        return { ok: true, json: async () => ({ data: { id: "created" } }) };
      }
      const url = String(input);
      const data = url.includes("/subthemes") ? [{ id: "sub1", themeId: "t1", name: "Existing subtheme", order: 1, status: "ACTIVE", _count: { weeks: 0 } }]
        : url.includes("/weeks") ? [] : [{ id: "t1", semesterId: "s1", name: "Existing theme", order: 1, status: "ACTIVE", _count: { subThemes: 1 } }];
      return { ok: true, json: async () => ({ data }) };
    }));
    render(<ThemesClient canWrite semester={semester} />);
    await screen.findByText("Existing theme");
    if (kind !== "theme") await user.click(screen.getByRole("button", { name: /Existing theme/, pressed: false }));
    if (kind === "week") await user.click(await screen.findByRole("button", { name: /Existing subtheme/, pressed: false }));
    await user.click(within(screen.getByTestId(`${kind}-card`)).getByRole("button", { name: "Tambah" }));
    const dialog = screen.getByRole("dialog");
    if (kind === "week") {
      fireEvent.change(within(dialog).getByLabelText(/Mulai/), { target: { value: "2026-07-06" } });
      fireEvent.change(within(dialog).getByLabelText(/Selesai/), { target: { value: "2026-07-10" } });
    } else fireEvent.change(within(dialog).getByLabelText(kind === "theme" ? /Nama tema/ : /Nama subtema/), { target: { value: "My draft" } });
    await user.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(MESSAGES.saveFailed));
    expect(within(dialog).getByRole("button", { name: "Batal" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Simpan" })).toBeEnabled();
    expect(within(dialog).getByDisplayValue(kind === "week" ? "2026-07-06" : "My draft")).toBeInTheDocument();
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes).toBe(2);
  });
});

describe("curriculum failed reads", () => {
  it.each([
    ["theme", "HTTP"], ["theme", "network"],
    ["subtheme", "HTTP"], ["subtheme", "network"],
    ["week", "HTTP"], ["week", "network"],
  ])("shows retry instead of a false empty state for %s %s failures", async (kind, failure) => {
    const user = userEvent.setup();
    let fail = true;
    const endpoint = kind === "theme" ? "/themes?" : kind === "subtheme" ? "/subthemes?" : "/weeks?";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(endpoint)) {
        if (fail && failure === "network") throw new TypeError("Failed to fetch");
        return { ok: !fail, json: async () => fail ? { error: "Unavailable" } : { data: [] } };
      }
      const data = url.includes("/subthemes?")
        ? [{ id: "sub1", themeId: "t1", name: "Existing subtheme", order: 1, status: "ACTIVE", _count: { weeks: 0 } }]
        : [{ id: "t1", semesterId: "s1", name: "Existing theme", order: 1, status: "ACTIVE", _count: { subThemes: 1 } }];
      return { ok: true, json: async () => ({ data }) };
    }));
    render(<ThemesClient canWrite semester={semester} />);
    if (kind !== "theme") await user.click(await screen.findByRole("button", { name: /Existing theme/, pressed: false }));
    if (kind === "week") await user.click(await screen.findByRole("button", { name: /Existing subtheme/, pressed: false }));
    const card = within(screen.getByTestId(`${kind}-card`));
    await card.findByRole("button", { name: "Coba lagi" });
    expect(card.queryByText(/Belum ada/)).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: "Tambah" })).toBeDisabled();
    fail = false;
    await user.click(card.getByRole("button", { name: "Coba lagi" }));
    expect(await card.findByText(/Belum ada/)).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: "Tambah" })).toBeEnabled();
  });
});

describe("curriculum selection races", () => {
  it.each([
    ["subtheme", "failure"], ["subtheme", "success"],
    ["week", "failure"], ["week", "success"],
  ])("ignores an old %s request's late %s after the new selection loads", async (kind, outcome) => {
    const user = userEvent.setup();
    const oldRequest = Promise.withResolvers<{ ok: boolean; json: () => Promise<{ data: unknown[] }> }>();
    let oldStarted = false;
    const theme = (id: string) => ({ id, semesterId: "s1", name: `Theme ${id}`, order: 1, status: "ACTIVE", _count: { subThemes: 1 } });
    const subtheme = (id: string) => ({ id, themeId: "A", name: `Subtheme ${id}`, order: 1, status: "ACTIVE", _count: { weeks: 1 } });
    const success = (data: unknown[]) => ({ ok: true, json: async () => ({ data }) });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/themes")) return success([theme("A"), theme("B")]);
      if (url.pathname.endsWith("/subthemes")) {
        if (kind === "subtheme" && url.searchParams.get("themeId") === "A") { oldStarted = true; return oldRequest.promise; }
        return success(kind === "week" ? [subtheme("A"), subtheme("B")] : [subtheme("B")]);
      }
      if (kind === "week" && url.searchParams.get("subThemeId") === "A") { oldStarted = true; return oldRequest.promise; }
      return success([]);
    }));
    render(<ThemesClient canWrite semester={semester} />);
    await user.click(await screen.findByRole("button", { name: /Theme A/, pressed: false }));
    if (kind === "week") await user.click(await screen.findByRole("button", { name: /Subtheme A/, pressed: false }));
    await waitFor(() => expect(oldStarted).toBe(true));
    await user.click(screen.getByRole("button", { name: kind === "week" ? /Subtheme B/ : /Theme B/, pressed: false }));
    const card = within(screen.getByTestId(`${kind}-card`));
    if (kind === "week") await card.findByText(/Belum ada pekan/);
    else await card.findByRole("button", { name: /Subtheme B/, pressed: false });
    await act(async () => {
      if (outcome === "failure") oldRequest.reject(new TypeError("Failed to fetch"));
      else oldRequest.resolve(success(kind === "week"
        ? [{ id: "old-week", subThemeId: "A", number: 99, startDate: "2026-07-06", endDate: "2026-07-10", status: "ACTIVE" }]
        : [subtheme("OLD")]));
    });
    expect(card.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: "Tambah" })).toBeEnabled();
    if (kind === "week") expect(card.getByText(/Belum ada pekan/)).toBeInTheDocument();
    else expect(card.getByRole("button", { name: /Subtheme B/, pressed: false })).toBeInTheDocument();
  });
});
