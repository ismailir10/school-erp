import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ params: new URLSearchParams("classId=c&date=2026-09-29") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/student-journal/note-compose-dialog", () => ({ NoteComposeDialog: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import Page from "../page";

const ok = (data: unknown) => ({ ok: true, json: async () => data });
const categories = [
  { id: "cat1", name: "Ibadah", order: 1, indicators: [{ id: "i1", label: "Sholat", order: 1 }, { id: "i2", label: "Doa", order: 2 }] },
  { id: "cat2", name: "Akhlak", order: 2, indicators: [{ id: "i3", label: "Sopan", order: 1 }] },
];
const students = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Siswa ${i + 1}`, nickname: null }));

let attendance: unknown = [];
let posts: Array<{ entries: Array<{ studentId: string; indicatorId: string; checked: boolean }> }>;
function stub(n: number, failPost?: (index: number) => boolean) {
  posts = [];
  attendance = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("class-grid")) {
        return Promise.resolve(ok({ data: { students: students(n), categories, entries: [], classSection: { id: "c", name: "TKIT A" } } }));
      }
      if (String(url).includes("student-attendance")) return Promise.resolve(ok(attendance));
      posts.push(JSON.parse(String(init?.body)));
      const failed = failPost?.(posts.length - 1);
      return Promise.resolve(failed ? { ok: false, json: async () => ({}) } : ok({ data: { saved: 1 } }));
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("class-level bulk fill (TCH-7)", () => {
  it("reserves the save-status row while idle so Jurnal tersimpan cannot shift the grid (TCH-8)", async () => {
    stub(2);
    render(<Page />);
    const row = await screen.findByTestId("journal-save-state");
    expect(row).toHaveClass("min-h-6");
    expect(row).toBeEmptyDOMElement();
    fireEvent.click(screen.getByTestId("bulk-open"));
    fireEvent.click(await screen.findByTestId("bulk-apply"));
    await waitFor(() => expect(screen.getByTestId("journal-save-state")).toHaveTextContent("Jurnal tersimpan"));
    expect(screen.getByTestId("journal-save-state")).toHaveClass("min-h-6");
  });

  it("fills the whole class in one open + one tap, as a single batched write", async () => {
    stub(3);
    render(<Page />);
    fireEvent.click(await screen.findByTestId("bulk-open"));
    fireEvent.click(await screen.findByTestId("bulk-apply"));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].entries).toHaveLength(9); // 3 siswa x 3 indikator
    expect(posts[0].entries.every((e) => e.checked)).toBe(true);
    expect(screen.getByTestId("class-progress")).toHaveTextContent("3/3 siswa lengkap");
    expect(screen.getByTestId("bulk-undo")).toHaveTextContent("Ditandai: 9 centang untuk 3 siswa.");
  });

  it("undo puts the class back the way it was", async () => {
    stub(2);
    render(<Page />);
    fireEvent.click(await screen.findByTestId("bulk-open"));
    fireEvent.click(await screen.findByTestId("bulk-apply"));
    await waitFor(() => expect(posts).toHaveLength(1));

    fireEvent.click(screen.getByTestId("bulk-undo-button"));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].entries).toHaveLength(6);
    expect(posts[1].entries.every((e) => e.checked === false)).toBe(true);
    expect(screen.getByTestId("class-progress")).toHaveTextContent("0/2 siswa lengkap");
    expect(screen.queryByTestId("bulk-undo")).toBeNull();
  });

  it("can be narrowed to a category and to chosen students", async () => {
    stub(3);
    render(<Page />);
    fireEvent.click(await screen.findByTestId("bulk-open"));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText("Indikator"), { target: { value: "cat:cat2" } });
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Semua siswa (3)" })); // none
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Siswa 2" }));

    expect(within(sheet).getByTestId("bulk-summary")).toHaveTextContent("1 siswa × 1 indikator: 1 centang");
    fireEvent.click(within(sheet).getByTestId("bulk-apply"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].entries).toEqual([{ studentId: "s2", indicatorId: "i3", checked: true }]);
  });

  it("posts a big class in bounded chunks and rolls back only the chunk that failed", async () => {
    stub(120, (index) => index === 1); // 360 cells -> 100 + 100 + 100 + 60; second chunk fails
    render(<Page />);
    fireEvent.click(await screen.findByTestId("bulk-open"));
    fireEvent.click(await screen.findByTestId("bulk-apply"));

    await waitFor(() => expect(posts).toHaveLength(4));
    expect(posts.map((p) => p.entries.length)).toEqual([100, 100, 100, 60]);
    expect(Math.max(...posts.map((p) => p.entries.length))).toBeLessThanOrEqual(500);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sebagian perubahan belum tersimpan");
    // 100 cells were rolled back, so at least one student is no longer complete.
    const done = Number(/^(\d+)\//.exec(screen.getByTestId("class-progress").textContent ?? "")?.[1]);
    expect(done).toBeLessThan(120);
    expect(done).toBeGreaterThan(0);
  });

  it("leaves children who are Sakit/Izin/Alpa today unselected, so Tandai does not tick them present (TCHX-7)", async () => {
    stub(5);
    attendance = [
      { student: { id: "s1" }, attendance: { status: "PRESENT" } },
      { student: { id: "s2" }, attendance: { status: "SICK" } },
      { student: { id: "s3" }, attendance: { status: "PERMISSION" } },
      { student: { id: "s4" }, attendance: { status: "ABSENT" } },
      { student: { id: "s5" }, attendance: null },
    ];
    render(<Page />);
    fireEvent.click(await screen.findByTestId("bulk-open"));

    expect(await screen.findByTestId("bulk-absent-note")).toHaveTextContent("3 siswa tidak hadir di tanggal ini tidak dipilih.");
    expect(screen.getByTestId("bulk-absence-s2")).toHaveTextContent("Sakit");
    expect(screen.getByTestId("bulk-absence-s3")).toHaveTextContent("Izin");
    expect(screen.getByTestId("bulk-absence-s4")).toHaveTextContent("Alpa");
    expect(screen.queryByTestId("bulk-absence-s1")).toBeNull();

    fireEvent.click(screen.getByTestId("bulk-apply"));
    await waitFor(() => expect(posts).toHaveLength(1));
    const touched = new Set(posts[0].entries.map((e) => e.studentId));
    expect([...touched].sort()).toEqual(["s1", "s5"]);
    expect(screen.getByTestId("class-progress")).toHaveTextContent("2/5 siswa lengkap");
  });

  it("falls back to selecting everyone when the attendance lookup fails", async () => {
    stub(3);
    const base = (fetch as unknown as ReturnType<typeof vi.fn>).getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        String(url).includes("student-attendance") ? Promise.reject(new Error("offline")) : base(url, init),
      ),
    );
    render(<Page />);
    fireEvent.click(await screen.findByTestId("bulk-open"));
    expect(screen.queryByTestId("bulk-absent-note")).toBeNull();
    fireEvent.click(await screen.findByTestId("bulk-apply"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].entries).toHaveLength(9);
  });

  it("hides the control when the school has no indicators", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(ok({ data: { students: students(2), categories: [], entries: [] } }))),
    );
    render(<Page />);
    await screen.findByTestId("class-progress");
    expect(screen.queryByTestId("bulk-open")).toBeNull();
  });
});
