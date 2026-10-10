import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardedLink } from "@/components/admin/guarded-link";
import { UnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";
import RaportTemplatesPage from "../page";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const terms = [{ id: "term-1", number: 1, semester: { number: 1, academicYear: { name: "2026/2027" } } }];
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const grid = (text: string) => response({ data: { bucketed: {}, closing: { CLOSING: text } } });

beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("narrative bank recovery", () => {
  it("guards sidebar and page navigation while a narrative draft is unsaved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/terms")
      ? response({ data: terms }) : grid("Existing")));
    render(<UnsavedChangesProvider>
      <GuardedLink href="/admin/students">Siswa</GuardedLink>
      <RaportTemplatesPage />
    </UnsavedChangesProvider>);
    fireEvent.change(await screen.findByDisplayValue("Existing"), { target: { value: "Unsaved" } });
    await user.click(screen.getByRole("link", { name: "Siswa" }));
    expect(await screen.findByText("Keluar tanpa menyimpan?")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Batal" }));
    expect(screen.getByDisplayValue("Unsaved")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Susun Rapor" }));
    await user.click(await screen.findByRole("button", { name: "Ya, Keluar" }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/admin/report-cards");
  });

  it("blocks saving after a failed read, then allows retry without clearing saved content", async () => {
    let fail = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes("/terms")
      ? response({ data: terms })
      : fail ? response({ error: "Gagal memuat bank narasi." }, false) : grid("Existing narrative"));
    vi.stubGlobal("fetch", fetcher);
    render(<RaportTemplatesPage />);
    await screen.findByRole("button", { name: "Coba lagi" });
    const save = screen.getByRole("button", { name: "Simpan semua" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByDisplayValue("Existing narrative")).toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it("ignores an old age-group response after the selected group has loaded", async () => {
    let finishA!: (value: ReturnType<typeof grid>) => void;
    const pendingA = new Promise<ReturnType<typeof grid>>((resolve) => { finishA = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/terms")) return Promise.resolve(response({ data: terms }));
      return url.includes("ageGroup=A") ? pendingA : Promise.resolve(grid("Group B narrative"));
    });
    vi.stubGlobal("fetch", fetcher);
    render(<RaportTemplatesPage />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Kelompok usia"), { target: { value: "B" } });
    await screen.findByDisplayValue("Group B narrative");
    await act(async () => { finishA(grid("Group A narrative")); });
    expect(screen.getByLabelText("Kelompok usia")).toHaveValue("B");
    expect(screen.getByDisplayValue("Group B narrative")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Group A narrative")).not.toBeInTheDocument();
  });

  it("preserves an unsaved draft when context switching is cancelled; discards only on confirmation", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/terms")
      ? response({ data: terms }) : grid(String(input).includes("ageGroup=B") ? "Group B" : "Group A")));
    render(<RaportTemplatesPage />);
    fireEvent.change(await screen.findByDisplayValue("Group A"), { target: { value: "Unsaved draft" } });
    fireEvent.change(screen.getByLabelText("Kelompok usia"), { target: { value: "B" } });
    await user.click(await screen.findByRole("button", { name: "Tetap di sini" }));
    expect(screen.getByLabelText("Kelompok usia")).toHaveValue("A");
    expect(screen.getByDisplayValue("Unsaved draft")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kelompok usia"), { target: { value: "B" } });
    await user.click(await screen.findByRole("button", { name: "Buang perubahan" }));
    expect(await screen.findByDisplayValue("Group B")).toBeInTheDocument();
  });

  it("retains typed content after a failed save and permits a successful retry", async () => {
    let failSave = true;
    let persisted = "Existing";
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/terms")) return response({ data: terms });
      if (init?.method === "PUT") {
        if (failSave) throw new TypeError("Failed to fetch");
        persisted = JSON.parse(String(init.body)).closings[0].content;
        return response({ data: { written: 1, cleared: 0 } });
      }
      return grid(persisted);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<RaportTemplatesPage />);
    fireEvent.change(await screen.findByDisplayValue("Existing"), { target: { value: "My draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan semua" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Simpan semua" })).toBeEnabled());
    expect(screen.getByDisplayValue("My draft")).toBeInTheDocument();
    failSave = false;
    fireEvent.click(screen.getByRole("button", { name: "Simpan semua" }));
    await waitFor(() => expect(persisted).toBe("My draft"));
    expect(await screen.findByDisplayValue("My draft")).toBeInTheDocument();
  });
});
