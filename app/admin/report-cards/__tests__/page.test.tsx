/**
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the roster row's identity
 * cell used to be plain text next to a "Lihat" row action that opened the
 * raport editor. The name is now a `DataTableLinkCell` button (no detail
 * route exists — opening the editor is an in-page overlay swap, not a
 * navigation) and the separate "Lihat" action is gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdminRaportPage from "@/app/admin/report-cards/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const term = {
  id: "term1",
  number: 1,
  startDate: "2026-07-01",
  endDate: "2026-09-30",
  publishedAt: null,
  semester: { id: "sem1", number: 1, academicYear: { name: "2026/2027" } },
};
const classRow = {
  id: "class1",
  name: "TK A",
  status: "ACTIVE",
  campus: { id: "c1", name: "Kampus Utama" },
  academicYear: { id: "ay1", name: "2026/2027", status: "ACTIVE" },
};
const rosterRow = { studentId: "s1", name: "Aisyah Putri", nickname: null, status: "NONE" };

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/admin/terms")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [term] }) } as Response);
    }
    if (url.includes("/api/admin/classes")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [classRow] }) } as Response);
    }
    if (url.includes("/api/admin/curriculum/semesters")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    if (url.includes("/api/admin/report-cards?")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { roster: [rosterRow] } }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("AdminRaportPage — name is the link (T7)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the roster name as the open-editor control and drops the separate Lihat button", async () => {
    const user = userEvent.setup();
    render(<AdminRaportPage />);

    await screen.findByLabelText("Triwulan");
    await user.selectOptions(screen.getByLabelText("Triwulan"), term.id);
    await user.selectOptions(screen.getByLabelText("Kelas"), classRow.id);

    const nameControl = await screen.findByRole("button", { name: "Aisyah Putri" });
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();

    await user.click(nameControl);
    expect(await screen.findByRole("button", { name: /Kembali ke daftar/ })).toBeInTheDocument();
  });
});

it("ignores a late roster after the selected class changes", async () => {
  const user = userEvent.setup();
  const fallback = stubFetch();
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>((resolve) => { release = resolve; });
  const secondClass = { ...classRow, id: "class2", name: "TK B" };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/admin/classes")) return Promise.resolve({ ok: true, json: async () => ({ data: [classRow, secondClass] }) } as Response);
    if (url.includes("/api/admin/report-cards?")) {
      if (url.includes("classSectionId=class1")) return delayed;
      return Promise.resolve({ ok: true, json: async () => ({ data: { roster: [{ ...rosterRow, studentId: "s2", name: "Siswa kelas B" }] } }) } as Response);
    }
    return fallback(input);
  }));
  render(<AdminRaportPage />);
  await screen.findByLabelText("Triwulan");
  await user.selectOptions(screen.getByLabelText("Triwulan"), term.id);
  await user.selectOptions(screen.getByLabelText("Kelas"), classRow.id);
  await user.selectOptions(screen.getByLabelText("Kelas"), secondClass.id);
  expect(await screen.findByRole("button", { name: "Siswa kelas B" })).toBeInTheDocument();
  await act(async () => {
    release({ ok: true, json: async () => ({ data: { roster: [rosterRow] } }) } as Response);
    await delayed;
  });
  expect(screen.getByLabelText("Kelas")).toHaveValue(secondClass.id);
  expect(screen.getByRole("button", { name: "Siswa kelas B" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Aisyah Putri" })).not.toBeInTheDocument();
});
