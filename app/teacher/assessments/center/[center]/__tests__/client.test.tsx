import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push, replace }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CenterSessionClient } from "../client";

const session = (writable = true) => ({
  week: { id: "week-1", number: 3, subTheme: { name: "Aku" }, theme: { name: "Diriku" } },
  center: "WORSHIP",
  date: "2026-08-03",
  ageGroup: "A",
  students: [{ id: "student-1", name: "Aisyah", nickname: null, status: "ACTIVE" }],
  indicators: [{ id: "indicator-1", content: "Mengikuti kegiatan", order: 1, objective: { id: "objective-1", ageGroup: "A", element: "Karakter" } }],
  entries: [],
  lastActivity: null,
  writable,
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });

function renderClient() {
  return render(<CenterSessionClient center="WORSHIP" centerLabel="Sentra Ibadah" />);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("CenterSessionClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    refresh.mockClear();
    push.mockClear();
    replace.mockClear();
  });

  it("uses keyboard-operable native age-group radios with 44px focus targets", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(session())));
    renderClient();
    const group = await screen.findByRole("radiogroup", { name: "Kelompok usia" });
    const a = within(group).getByRole("radio", { name: "TK A" });
    const b = within(group).getByRole("radio", { name: "TK B" });
    expect(a).toBeChecked();
    expect(a.closest("label")).toHaveClass("min-h-11");
    expect(a.closest("label")).toHaveClass("has-[input:focus-visible]:ring-2");
    a.focus();
    await user.keyboard("{ArrowRight}");
    expect(b).toBeChecked();
    expect(b).toHaveFocus();
  });

  it("shows retryable load failure instead of the legitimate empty state, then recovers", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => ++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(ok(session()))));
    renderClient();
    await screen.findByRole("alert");
    expect(screen.getByText("Tidak bisa memuat sentra")).toBeInTheDocument();
    expect(screen.queryByTestId("center-indicator-picker")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.getByTestId("center-indicator-picker")).toBeInTheDocument());
  });

  it("ignores a stale earlier load after the date changes", async () => {
    const first = deferred<ReturnType<typeof ok>>();
    const second = deferred<ReturnType<typeof ok>>();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => ++calls === 1 ? first.promise : second.promise));
    renderClient();
    // Derive the "other" date from the picker's current value rather than
    // hardcoding one. The input defaults to today, so a literal stops forcing a
    // refetch the day the clock reaches it — the previous "2026-08-04" went
    // red on 2026-08-04 and stayed red.
    const dateInput = screen.getByTestId("center-date") as HTMLInputElement;
    const otherDay = new Date(`${dateInput.value}T00:00:00Z`);
    otherDay.setUTCDate(otherDay.getUTCDate() - 1);
    fireEvent.change(dateInput, {
      target: { value: otherDay.toISOString().slice(0, 10) },
    });
    await waitFor(() => expect(calls).toBe(2));
    second.resolve(ok({ ...session(), indicators: [{ ...session().indicators[0], id: "indicator-new", content: "Data baru" }] }));
    await screen.findByText("Data baru");
    await act(async () => { first.resolve(ok({ ...session(), indicators: [{ ...session().indicators[0], content: "Data lama" }] })); });
    expect(screen.queryByText("Data lama")).toBeNull();
    expect(screen.getByText("Data baru")).toBeInTheDocument();
  });

  it("shows a safe-area save footer only for writable payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(session(true))));
    const writable = renderClient();
    const save = await screen.findByTestId("center-save");
    expect(save.parentElement?.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    // Opaque base + a blurred translucent upgrade only where backdrop-filter
    // is supported — the old flat `bg-background/95` let roster rows show
    // through the bar mid-scroll.
    expect(save.parentElement?.className).toContain("bg-background");
    expect(save.parentElement?.className).toContain("backdrop-blur");
    writable.unmount();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({
      ...session(false),
      entries: [{
        id: "entry-1",
        studentId: "student-1",
        indicatorId: "indicator-1",
        level: "CONSISTENT",
        note: "Sudah dicatat",
        activity: "Doa pagi",
      }],
    })));
    renderClient();
    await screen.findByTestId("center-indicator-picker");
    expect(screen.queryByTestId("center-save")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Sesi ini hanya bisa dilihat");
    // Date + age group stay ENABLED on a read-only session: they are the only
    // controls that can move the teacher to a writable one, so disabling them
    // made read-only a dead end.
    expect(screen.getByTestId("center-date")).toBeEnabled();
    expect(screen.getByRole("radio", { name: "TK A" })).toBeEnabled();
    // Everything that writes to this session stays disabled.
    expect(screen.getByTestId("center-activity")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Karakter.*Mengikuti kegiatan/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Mampu untuk / })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tambah catatan" })).toBeDisabled();
    expect(screen.getByText("Catatan: Sudah dicatat")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Catatan singkat (opsional)")).toBeNull();
  });

  describe("unsaved-changes guard (TCHX-3)", () => {
    async function dirtyClient() {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(session())));
      renderClient();
      fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
      fireEvent.change(screen.getByTestId("center-activity"), { target: { value: "Doa pagi" } });
      fireEvent.click(screen.getByRole("radio", { name: /^Mampu untuk Aisyah/ }));
    }

    it("asks before an in-app link discards unsaved picks, and leaves on confirm", async () => {
      await dirtyClient();
      fireEvent.click(screen.getByRole("link", { name: /kembali/i }));
      expect(await screen.findByText("Keluar tanpa menyimpan?")).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Keluar tanpa menyimpan" }));
      await waitFor(() => expect(replace.mock.calls.length + push.mock.calls.length).toBe(1));
    });

    it("stays put on 'Tetap di sini'", async () => {
      await dirtyClient();
      fireEvent.click(screen.getByRole("link", { name: /kembali/i }));
      fireEvent.click(await screen.findByRole("button", { name: "Tetap di sini" }));
      await waitFor(() => expect(screen.queryByText("Keluar tanpa menyimpan?")).toBeNull());
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it("does not prompt while nothing has been edited", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(session())));
      renderClient();
      await screen.findByTestId("center-indicator-picker");
      // Bubble-phase backstop so jsdom does not try to navigate; the guard (capture) has already run.
      document.addEventListener("click", (e) => e.preventDefault(), { once: true });
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      screen.getByRole("link", { name: /kembali/i }).dispatchEvent(event);
      expect(screen.queryByText("Keluar tanpa menyimpan?")).toBeNull();
    });

    it("is clean again after a successful save", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(ok(session()))
        .mockResolvedValueOnce(ok({ written: 1 }));
      vi.stubGlobal("fetch", fetchMock);
      renderClient();
      fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
      fireEvent.change(screen.getByTestId("center-activity"), { target: { value: "Doa pagi" } });
      fireEvent.click(screen.getByRole("radio", { name: /^Mampu untuk Aisyah/ }));
      fireEvent.click(screen.getByTestId("center-save"));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      // Bubble-phase backstop so jsdom does not try to navigate; the guard (capture) has already run.
      document.addEventListener("click", (e) => e.preventDefault(), { once: true });
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      screen.getByRole("link", { name: /kembali/i }).dispatchEvent(event);
      expect(screen.queryByText("Keluar tanpa menyimpan?")).toBeNull();
    });

    it("asks before a date change drops unsaved picks, and only reloads on confirm", async () => {
      await dirtyClient();
      const fetchMock = vi.mocked(fetch);
      const dateInput = screen.getByTestId("center-date") as HTMLInputElement;
      const before = fetchMock.mock.calls.length;
      const other = new Date(`${dateInput.value}T00:00:00Z`);
      other.setUTCDate(other.getUTCDate() - 1);
      fireEvent.change(dateInput, { target: { value: other.toISOString().slice(0, 10) } });
      expect(await screen.findByText("Ganti tanpa menyimpan?")).toBeInTheDocument();
      expect(fetchMock.mock.calls.length).toBe(before);

      fireEvent.click(screen.getByRole("button", { name: "Ganti tanpa menyimpan" }));
      await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
    });

    it("asks before an age-group switch drops unsaved picks", async () => {
      await dirtyClient();
      fireEvent.click(screen.getByRole("radio", { name: "TK B" }));
      expect(await screen.findByText("Ganti tanpa menyimpan?")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "TK A", hidden: true })).toBeChecked();
    });
  });

  describe("date picker (TCHX-12)", () => {
    it("caps the date at today and ignores a typed future date", async () => {
      const fetchMock = vi.fn().mockResolvedValue(ok(session()));
      vi.stubGlobal("fetch", fetchMock);
      renderClient();
      await screen.findByTestId("center-indicator-picker");
      const dateInput = screen.getByTestId("center-date") as HTMLInputElement;
      const today = dateInput.value;
      expect(dateInput.max).toBe(today);

      const future = new Date(`${today}T00:00:00Z`);
      future.setUTCDate(future.getUTCDate() + 7);
      const calls = fetchMock.mock.calls.length;
      fireEvent.change(dateInput, { target: { value: future.toISOString().slice(0, 10) } });
      expect(fetchMock.mock.calls.length).toBe(calls);
      expect(dateInput.value).toBe(today);
    });
  });

  describe("no active week (TCH-6)", () => {
    it("says it once, offers no retry, and does not console.error an expected 422", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: "Belum ada Pekan aktif untuk tanggal yang dipilih.",
          reason: "no_active_week",
        }),
      }));
      renderClient();
      expect(await screen.findByText("Belum ada pekan aktif untuk tanggal ini")).toBeInTheDocument();
      expect(screen.getByText(/Pilih hari sekolah lain\./)).toBeInTheDocument();
      expect(screen.queryByText(/pilih tanggal/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
