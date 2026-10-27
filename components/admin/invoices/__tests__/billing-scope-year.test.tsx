import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/student-picker", () => ({ StudentPicker: () => null }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionMultiPicker: ({ sections, value, onChange }: { sections: { id: string; name: string }[]; value: string[]; onChange: (ids: string[]) => void }) => <div>{sections.map(section => <label key={section.id}><input type="checkbox" checked={value.includes(section.id)} onChange={() => onChange(value.includes(section.id) ? value.filter(id => id !== section.id) : [...value, section.id])} />{section.name}</label>)}</div>,
}));
import { ScopeStep } from "../billing-run-wizard/step-1-scope";
const years = [{ id: "ay-new", name: "2026/2027", status: "ACTIVE" }, { id: "ay-old", name: "2025/2026", status: "ACTIVE" }];
const classes = [{ id: "class-new", name: "Kelas Baru", academicYearId: "ay-new", program: { name: "TK A" } }, { id: "class-old", name: "Kelas Lama", academicYearId: "ay-old", program: { name: "TK A" } }];
beforeEach(() => vi.clearAllMocks());
describe("billing scope academic year", () => {
  it("shows only the selected year's classes and requires a fresh selection after switching years", async () => {
    const user = userEvent.setup();
    const advance = vi.fn();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? { status: 201, json: async () => ({ id: "new-run" }) }
      : { ok: true, json: async () => classes });
    vi.stubGlobal("fetch", fetcher);
    render(<ScopeStep years={years} onAdvance={advance} onCancel={vi.fn()} />);
    await user.click(await screen.findByRole("checkbox", { name: "Kelas Baru" }));
    expect(screen.queryByRole("checkbox", { name: "Kelas Lama" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Tahun Ajaran" }));
    await user.click(await screen.findByRole("option", { name: "2025/2026" }));
    expect(screen.queryByRole("checkbox", { name: "Kelas Baru" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Kelas Lama" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));
    expect(screen.getByText("Pilih minimal satu kelas atau siswa untuk ditagih")).toBeVisible();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    await user.click(screen.getByRole("checkbox", { name: "Kelas Lama" }));
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await waitFor(() => expect(advance).toHaveBeenCalledWith("new-run"));
    const request = fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ academicYearId: "ay-old", classSectionIds: ["class-old"] });
  });
});
