import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StudentAttendancePage from "../page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-coarse-pointer", () => ({ useCoarsePointer: () => true }));

const row = {
  id: "attendance-synthetic", date: "2026-10-10", status: "PRESENT", notes: null,
  student: { id: "student-synthetic", name: "Synthetic Attendance Student", nickname: null },
  classSection: { id: "class-synthetic", name: "Synthetic Class" },
};
function list(rows = [row]) {
  return { ok: true, json: async () => ({ data: rows, pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 } }) } as Response;
}
function stubList(handler: (url: string) => Promise<Response>) {
  const fetchSpy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/student-attendance?")) return handler(url);
    return Promise.resolve({ ok: true, json: async () => url.includes("stats") ? { present: 0, absent: 0, sick: 0, permission: 0 } : [] } as Response);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}
beforeEach(() => vi.clearAllMocks());

describe("attendance list recovery", () => {
  it.each(["HTTP", "network"])("shows persistent retry after %s failure without claiming an empty list", async (failure) => {
    let fails = true;
    stubList(async () => {
      if (!fails) return list();
      if (failure === "network") throw new Error("offline");
      return { ok: false, status: 503 } as Response;
    });
    render(<StudentAttendancePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Data kehadiran belum bisa dimuat");
    expect(screen.queryByText("Tidak ada catatan kehadiran")).not.toBeInTheDocument();
    expect(screen.queryByText("0 catatan")).not.toBeInTheDocument();
    fails = false;
    await userEvent.click(screen.getByRole("button", { name: "Coba Lagi" }));
    expect(await screen.findByText(row.student.name)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains successful rows with a stale-data warning when refreshing a filter fails", async () => {
    let fails = false;
    const fetchSpy = stubList(async () => fails ? { ok: false, status: 503 } as Response : list());
    render(<StudentAttendancePage />);
    await screen.findByText(row.student.name);
    fails = true;
    fireEvent.change(screen.getByPlaceholderText("Cari nama siswa..."), { target: { value: "new filter" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Hasil terakhir masih ditampilkan");
    expect(screen.getByText(row.student.name)).toBeInTheDocument();
    expect(screen.getByText("1 catatan pada hasil terakhir")).toBeInTheDocument();
    fails = false;
    await userEvent.click(screen.getByRole("button", { name: "Coba Lagi" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("search=new+filter"))).toHaveLength(2);
  });

  it("ignores an older successful search after the latest search has failed", async () => {
    let resolveOld!: (response: Response) => void;
    const older = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchSpy = stubList(async (url) => {
      const query = new URL(url, "http://localhost").searchParams.get("search");
      if (query === "old") return older;
      if (query === "latest") return { ok: false, status: 503 } as Response;
      return list();
    });
    render(<StudentAttendancePage />);
    await screen.findByText(row.student.name);
    const search = screen.getByPlaceholderText("Cari nama siswa...");
    fireEvent.change(search, { target: { value: "old" } });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("search=old")));
    fireEvent.change(search, { target: { value: "latest" } });
    await screen.findByRole("alert");
    await act(async () => { resolveOld(list([{ ...row, student: { ...row.student, name: "Obsolete result" } }])); });
    expect(screen.getByRole("alert")).toHaveTextContent("Data kehadiran belum bisa dimuat");
    expect(screen.getByText(row.student.name)).toBeInTheDocument();
    expect(screen.queryByText("Obsolete result")).not.toBeInTheDocument();
  });

  it("distinguishes a successful empty list from an empty search result", async () => {
    stubList(async () => list([]));
    render(<StudentAttendancePage />);
    expect(await screen.findByText("Tidak ada catatan kehadiran")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Cari nama siswa..."), { target: { value: "unknown" } });
    expect(await screen.findByText("Tidak ada hasil untuk filter ini")).toBeInTheDocument();
    expect(screen.queryByText("Catatan kehadiran siswa akan tampil di sini setelah guru mencatat kehadiran.")).not.toBeInTheDocument();
  });
});
