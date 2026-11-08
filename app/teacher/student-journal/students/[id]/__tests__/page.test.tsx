import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  params: new URLSearchParams("week=2026-08-03"),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "student_1" }),
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => nav.params,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/components/portal/week-grid", () => ({
  WeekGrid: () => <div data-testid="week-grid" />,
}));
// The thread is its own fetching component now (covered by
// components/student-journal/__tests__/note-thread-panel.test.tsx); this page
// only owns the week grid, the header and the navigator.
vi.mock("@/components/student-journal/note-thread-panel", () => ({
  NoteThreadPanel: () => <div data-testid="note-thread" />,
}));
vi.mock("@/components/student-journal/note-compose-dialog", () => ({
  NoteComposeDialog: () => null,
}));

import TeacherStudentWeekPage from "../page";

const weekData = {
  data: {
    weekStart: "2026-08-03",
    dates: ["2026-08-03", "2026-08-04"],
    student: {
      id: "student_1",
      name: "Abdullah Faris Siregar",
      nickname: "Abdullah",
      classNames: ["DCARE"],
      classes: [{ id: "class-1", name: "DCARE" }],
    },
    categories: [],
    entries: [],
    notes: [],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("TeacherStudentWeekPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    nav.push.mockClear();
    toastError.mockClear();
  });

  it("shows a retryable error instead of empty history after rejection, then recovers", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() =>
      ++calls === 1 ? Promise.reject(new Error("Koneksi terputus")) : Promise.resolve({ ok: true, json: async () => weekData }),
    ));
    render(<TeacherStudentWeekPage />);

    await screen.findByText("Data penghubung tidak bisa dimuat");
    expect(screen.queryByTestId("week-grid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.getByTestId("week-grid")).toBeInTheDocument());
    expect(
      screen.getByText("Riwayat penghubung — hanya bisa dilihat di sini"),
    ).toBeInTheDocument();
  });

  it("uses a deterministic back target and accessible 44px week controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => weekData }));
    render(<TeacherStudentWeekPage />);
    await screen.findByTestId("week-grid");

    // Back is a Link now (shared BackLink), not a router.push button.
    expect(screen.getByRole("link", { name: "Kembali" })).toHaveAttribute(
      "href",
      "/teacher/student-journal",
    );

    // Shared WeekNavigator: 44px controls, and "pekan" not "minggu".
    for (const name of ["Pekan sebelumnya", "Pekan berikutnya"]) {
      const control = screen.getByRole("button", { name });
      // Button size="icon" grows to 44px on coarse pointers.
      expect(control.className).toContain("min-h-11");
      expect(control.className).toContain("min-w-11");
      expect(control.className).toContain("focus-visible:ring-3");
    }
  });

  it("names the student the week belongs to, with nickname and class", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => weekData }));
    render(<TeacherStudentWeekPage />);
    await screen.findByTestId("week-grid");

    expect(
      screen.getByRole("heading", { level: 1, name: "Abdullah Faris Siregar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Abdullah · DCARE")).toBeInTheDocument();
  });

  it("renders the grid even when the payload carries no student identity", async () => {
    const withoutStudent = { data: { ...weekData.data, student: null } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => withoutStudent }));
    render(<TeacherStudentWeekPage />);

    await screen.findByTestId("week-grid");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Buku Penghubung siswa");
  });

  it("offers a jump into the fill grid, carrying the class and the day", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => weekData }));
    render(<TeacherStudentWeekPage />);
    await screen.findByTestId("week-grid");

    // Viewing a past week (?week=2026-08-03): the jump targets that week's last
    // day rather than today, which is the day a guru paging back is fixing.
    expect(screen.getByTestId("fill-day-link")).toHaveAttribute(
      "href",
      "/teacher/student-journal/entry?classId=class-1&date=2026-08-04",
    );
  });

  it("hides the jump when the payload carries no class for the student", async () => {
    const noClasses = {
      data: { ...weekData.data, student: { ...weekData.data.student, classes: [] } },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => noClasses }));
    render(<TeacherStudentWeekPage />);
    await screen.findByTestId("week-grid");

    expect(screen.queryByTestId("fill-day-link")).toBeNull();
  });

  it("ignores a stale prior-week response after week navigation", async () => {
    const first = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const second = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    let calls = 0;
    // Only week loads are counted: the page also asks /api/auth/me who the
    // teacher is (to offer edit/delete on her own notes), which is not a week.
    vi.stubGlobal("fetch", vi.fn((url: string) =>
      String(url).includes("/week")
        ? (++calls === 1 ? first.promise : second.promise)
        : Promise.resolve({ ok: true, json: async () => ({}) }),
    ));
    render(<TeacherStudentWeekPage />);

    fireEvent.click(screen.getByRole("button", { name: "Pekan berikutnya" }));
    await waitFor(() => expect(calls).toBe(2));
    second.resolve({ ok: true, json: async () => weekData });
    await screen.findByTestId("week-grid");

    // Flush the stale prior-week response before asserting it was ignored.
    // The `waitFor` this replaces was satisfied on its first poll — the
    // heading was already rendered by the newer response — so it was not a
    // barrier, and the range assertion below raced the stale response's
    // flush. `await act` makes that flush deterministic.
    await act(async () => {
      first.resolve({
        ok: true,
        json: async () => ({ data: { ...weekData.data, dates: ["2026-07-27"] } }),
      });
    });
    expect(
      screen.getByText("Riwayat penghubung — hanya bisa dilihat di sini"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 Agu – 4 Agu 2026")).toBeInTheDocument();
  });

  it("shows what the wali ticked at home, read-only and apart from the school grid (X-5)", async () => {
    const withHome = {
      data: {
        ...weekData.data,
        homeCategories: [{ id: "h", name: "Rumah", scope: "HOME", indicators: [{ id: "h1", label: "Sholat 5 waktu", order: 1 }] }],
        homeEntries: [{ id: "e", indicatorId: "h1", date: "2026-08-03", checked: true }],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => withHome }));
    render(<TeacherStudentWeekPage />);
    const section = await screen.findByTestId("home-section");

    expect(screen.getByRole("heading", { level: 2, name: "Di rumah" })).toBeInTheDocument();
    expect(section).toHaveTextContent("hanya bisa dilihat di sini");
    // Two grids: the school week and the home week. Neither is editable (mock has no toggle).
    expect(screen.getAllByTestId("week-grid")).toHaveLength(2);
  });

  it("omits the Di rumah section when the school has no home checklist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => weekData }));
    render(<TeacherStudentWeekPage />);
    await screen.findByTestId("week-grid");
    expect(screen.queryByTestId("home-section")).toBeNull();
  });
});
