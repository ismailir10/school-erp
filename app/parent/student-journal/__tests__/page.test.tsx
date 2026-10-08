import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { weekDates, weekStart } from "@/lib/student-journal/week";

// T1 — the render gate in ../page.tsx must key off `schoolCategories` /
// `homeCategories` (whether the tenant template has ACTIVE categories),
// NOT off `schoolEntries` / `homeEntries` / `notes`. A week with zero
// entries and zero notes must still render the tabs (incl. the editable
// "Di Rumah" grid) as long as the template has at least one category —
// otherwise a wali can never make the first tick.

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/parent/student-journal",
  useSearchParams: () => nav.params,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The thread fetches for itself (covered in
// components/student-journal/__tests__/note-thread-panel.test.tsx).
vi.mock("@/components/student-journal/note-thread-panel", () => ({
  NoteThreadPanel: () => <div data-testid="note-thread-panel" />,
}));

import ParentStudentJournalPage from "../page";

const children = [
  { id: "child_1", name: "Aisyah Nuraini", nickname: "Aisyah", className: "TKA" },
];

const baseWeekData = {
  weekStart: "2026-08-10",
  dates: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"],
  schoolCategories: [] as unknown[],
  homeCategories: [] as unknown[],
  schoolEntries: [] as unknown[],
  homeEntries: [] as unknown[],
  notes: [] as unknown[],
};

const homeCategories = [
  {
    id: "cat_home_1",
    name: "Ibadah",
    scope: "HOME",
    indicators: [
      { id: "ind_1", label: "Shalat Subuh", order: 1 },
      { id: "ind_2", label: "Mengaji", order: 2 },
    ],
  },
];

function mockFetchWith(weekData: Record<string, unknown>, family = children) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/auth/me") {
        return Promise.resolve({ ok: true, json: async () => ({ id: "user_1" }) });
      }
      if (url === "/api/parent/children") {
        return Promise.resolve({ ok: true, json: async () => ({ data: family }) });
      }
      if (url.startsWith("/api/student-journal/notes/unread")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { unreadNoteCounts: { child_1: 3 } } }),
        });
      }
      if (url.startsWith("/api/student-journal/children/")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: weekData }) });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    }),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ParentStudentJournalPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    nav.replace.mockClear();
    nav.push.mockClear();
    nav.params = new URLSearchParams();
  });

  it("restores the linked child from URL on reload and keeps it through selection", async () => {
    const family = [
      ...children,
      { id: "child_2", name: "Yusuf Rahman", nickname: "Yusuf", className: "TKB" },
    ];
    nav.params = new URLSearchParams("child=child_2&view=notes&week=2026-08-10");
    mockFetchWith({ ...baseWeekData, homeCategories }, family);
    const { rerender } = render(<ParentStudentJournalPage />);
    await screen.findByText("Yusuf Rahman · TKB");
    // Identity renders from the children response; the week request starts in
    // a subsequent effect. Wait for that observable request, not its heading.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/student-journal/children/child_2/week?weekStart=2026-08-10",
    ));
    expect(await screen.findByTestId("note-thread-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Aisyah/ }));
    const destination = "/parent/student-journal?child=child_1&view=notes&week=2026-08-10";
    expect(nav.push).toHaveBeenCalledWith(destination);

    // Complete the router transition so the selected sibling's request and
    // preserved note/week context are checked, not just a mocked push call.
    nav.params = new URL(destination, "http://localhost").searchParams;
    rerender(<ParentStudentJournalPage />);
    await screen.findByText("Aisyah Nuraini · TKA");
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/student-journal/children/child_1/week?weekStart=2026-08-10",
    ));
    expect(await screen.findByTestId("note-thread-panel")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Catatan/ })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps full child identity visible when siblings share a nickname", async () => {
    const family = [
      ...children,
      { id: "child_2", name: "Aisyah Zahra", nickname: "Aisyah", className: "TKB" },
    ];
    nav.params = new URLSearchParams("child=child_2&view=notes");
    mockFetchWith({ ...baseWeekData, homeCategories }, family);
    const { container } = render(<ParentStudentJournalPage />);
    expect(await screen.findByText("Aisyah Zahra · TKB")).toBeVisible();
    expect(container.querySelector('[data-slot="context-strip"]')).toHaveTextContent("Aisyah Zahra");
    expect(container.querySelector('[data-slot="context-strip"]')).not.toHaveTextContent("Aisyah Nuraini");
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("/children/child_2/week")));
  });

  it("falls back to a linked child when the URL names another family's child", async () => {
    nav.params = new URLSearchParams("child=foreign");
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);
    await screen.findByText("Aisyah Nuraini · TKA");
    // The child heading renders before the effect starts its week request.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/children/child_1/week"),
    ));
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining("/children/foreign/week"),
    );
    // PAR-11: the swap is announced and the foreign id leaves the URL.
    expect(screen.getByTestId("child-param-notice")).toHaveTextContent(
      "Anak yang dipilih tidak ditemukan di akun Anda. Menampilkan Aisyah.",
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(
      "/parent/student-journal?child=child_1",
      { scroll: false },
    ));
  });

  it("gives the Tulis catatan button a 44px tap target (PAR-14)", async () => {
    nav.params = new URLSearchParams("view=notes");
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);
    expect(await screen.findByRole("button", { name: /Tulis catatan/ })).toHaveClass("min-h-11");
  });

  it("shows the EmptyState only when both schoolCategories and homeCategories are empty", async () => {
    mockFetchWith(baseWeekData);
    render(<ParentStudentJournalPage />);

    await screen.findByText("Jurnal belum diatur sekolah");
    expect(
      screen.getByText(
        "Sekolah belum menambahkan indikator harian untuk Jurnal. Hubungi admin sekolah untuk informasi lebih lanjut.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Di rumah" })).not.toBeInTheDocument();
  });

  it("renders the Di Rumah tab and its indicators when homeCategories is non-empty, even with zero entries and notes", async () => {
    nav.params = new URLSearchParams("view=home");
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    // Tabs render instead of the EmptyState.
    await screen.findByRole("tab", { name: "Di rumah" });
    expect(screen.queryByText("Jurnal belum diatur sekolah")).not.toBeInTheDocument();

    // The "Di Rumah" panel (active via ?view=home) shows the template's
    // indicators even though schoolEntries/homeEntries/notes are all [].
    expect(await screen.findByText("Shalat Subuh")).toBeInTheDocument();
    expect(screen.getByText("Mengaji")).toBeInTheDocument();
  });

  it("names the child and class the journal is showing", async () => {
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    // Was the static "Pantau kegiatan harian di sekolah dan rumah" — which
    // named no child at all, and a single-child wali saw no name anywhere.
    expect(await screen.findByText("Aisyah Nuraini · TKA")).toBeInTheDocument();
  });

  it("badges the Catatan tab with the wali's unread count", async () => {
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    await screen.findByRole("tab", { name: /Catatan/ });
    const badge = await screen.findByTestId("notes-unread-badge");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveAttribute("aria-label", "3 catatan baru");
  });

  it("opens the week named in ?week= instead of snapping back to this week", async () => {
    // Any day of the week is accepted and snapped to its Monday, so a link to
    // "the day Ustadzah wrote" opens that week.
    nav.params = new URLSearchParams("week=2026-08-12");
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    await screen.findByRole("tab", { name: "Di rumah" });
    const weekFetch = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((call) => call[0])
      .find((url) => url.startsWith("/api/student-journal/children/"));
    expect(weekFetch).toContain("weekStart=2026-08-10");
  });

  it("falls back to the current week when ?week= is not a real date", async () => {
    nav.params = new URLSearchParams("week=2026-02-31");
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    await screen.findByRole("tab", { name: "Di rumah" });
    const weekFetch = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((call) => call[0])
      .find((url) => url.startsWith("/api/student-journal/children/"));
    expect(weekFetch).not.toContain("weekStart=2026-02-31");
  });

  it("writes the week to the URL when the reader pages back", async () => {
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    await screen.findByRole("tab", { name: "Di rumah" });
    fireEvent.click(screen.getByRole("button", { name: "Pekan sebelumnya" }));

    expect(nav.replace).toHaveBeenCalledWith(
      expect.stringContaining("week="),
      { scroll: false },
    );
  });

  it("cannot page into a future week", async () => {
    mockFetchWith({ ...baseWeekData, homeCategories });
    render(<ParentStudentJournalPage />);

    await screen.findByRole("tab", { name: "Di rumah" });
    // Opened on the current week (no ?week=), so forward is inert.
    expect(
      screen.getByRole("button", {
        name: "Pekan berikutnya — pekan berikutnya belum tersedia",
      }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Kembali ke pekan ini" })).toBeNull();
  });

  it("ignores a stale week response after the wali switches children", async () => {
    const family = [
      ...children,
      { id: "child_2", name: "Yusuf Rahman", nickname: "Yusuf", className: "TKB" },
    ];
    const a = deferred<{ ok: boolean; json: () => Promise<{ data: typeof baseWeekData }> }>();
    const b = deferred<{ ok: boolean; json: () => Promise<{ data: typeof baseWeekData }> }>();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/auth/me") return Promise.resolve({ ok: true, json: async () => ({ id: "user_1" }) });
      if (url === "/api/parent/children") return Promise.resolve({ ok: true, json: async () => ({ data: family }) });
      if (url.startsWith("/api/student-journal/notes/unread")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { unreadNoteCounts: {} } }) });
      }
      if (url.includes("/children/child_1/")) return a.promise;
      if (url.includes("/children/child_2/")) return b.promise;
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    }));

    const { rerender } = render(<ParentStudentJournalPage />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("/children/child_1/week")));
    nav.params = new URLSearchParams("child=child_2&view=home");
    rerender(<ParentStudentJournalPage />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("/children/child_2/week")));

    b.resolve({
      ok: true,
      json: async () => ({ data: { ...baseWeekData, homeCategories: [{ ...homeCategories[0], indicators: [{ id: "yusuf", label: "Jurnal Yusuf", order: 1 }] }] } }),
    });
    expect(await screen.findByText("Jurnal Yusuf")).toBeInTheDocument();
    await act(async () => {
      a.resolve({
        ok: true,
        json: async () => ({ data: { ...baseWeekData, homeCategories: [{ ...homeCategories[0], indicators: [{ id: "aisyah", label: "Jurnal Aisyah", order: 1 }] }] } }),
      });
      await a.promise;
    });

    expect(screen.getByText("Jurnal Yusuf")).toBeInTheDocument();
    expect(screen.queryByText("Jurnal Aisyah")).not.toBeInTheDocument();
  });

  it("does not let a stale post-mutation refresh replace the newly selected child", async () => {
    const family = [
      ...children,
      { id: "child_2", name: "Yusuf Rahman", nickname: "Yusuf", className: "TKB" },
    ];
    nav.params = new URLSearchParams("view=home");
    const today = getTodayInTimezone("Asia/Jakarta");
    const currentDates = weekDates(weekStart(today));
    const initialA = { ...baseWeekData, dates: currentDates, homeCategories };
    const refreshedA = deferred<{ ok: boolean; json: () => Promise<{ data: typeof initialA }> }>();
    let childACalls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/auth/me") return Promise.resolve({ ok: true, json: async () => ({ id: "user_1" }) });
      if (url === "/api/parent/children") return Promise.resolve({ ok: true, json: async () => ({ data: family }) });
      if (url.startsWith("/api/student-journal/notes/unread")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { unreadNoteCounts: {} } }) });
      }
      if (url === "/api/student-journal/entries/home") {
        return Promise.resolve({ ok: true, json: async () => ({ data: {} }) });
      }
      if (url.includes("/children/child_1/")) {
        childACalls += 1;
        if (childACalls === 1) return Promise.resolve({ ok: true, json: async () => ({ data: initialA }) });
        return refreshedA.promise;
      }
      if (url.includes("/children/child_2/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { ...initialA, homeCategories: [{ ...homeCategories[0], indicators: [{ id: "yusuf", label: "Jurnal Yusuf", order: 1 }] }] } }),
        });
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    }));

    const { rerender } = render(<ParentStudentJournalPage />);
    // Monday is present and editable even when the test runs on a weekend.
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Shalat Subuh ${currentDates[0]}`) }));
    await waitFor(() => expect(childACalls).toBe(2));

    nav.params = new URLSearchParams("child=child_2&view=home");
    rerender(<ParentStudentJournalPage />);
    expect(await screen.findByText("Jurnal Yusuf")).toBeInTheDocument();
    await act(async () => {
      refreshedA.resolve({ ok: true, json: async () => ({ data: initialA }) });
      await refreshedA.promise;
    });

    expect(screen.getByText("Jurnal Yusuf")).toBeInTheDocument();
    expect(screen.queryByText("Shalat Subuh")).not.toBeInTheDocument();
  });
});
