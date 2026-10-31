import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push, replace }) }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

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
    toastError.mockClear();
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

  it("marks a missing kegiatan at the field on Simpan, focuses it, and clears once filled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(session()));
    vi.stubGlobal("fetch", fetchMock);
    renderClient();
    fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
    const activity = screen.getByTestId("center-activity");
    expect(activity).not.toHaveAttribute("aria-invalid");

    fireEvent.click(screen.getByTestId("center-save"));

    const error = await screen.findByText("Isi kegiatan dulu sebelum menyimpan.");
    expect(error).toHaveAttribute("id", "center-activity-error");
    expect(activity).toHaveAttribute("aria-invalid", "true");
    expect(activity).toHaveAttribute("aria-describedby", "center-activity-error");
    expect(activity).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the load, nothing saved

    fireEvent.change(activity, { target: { value: "Doa pagi" } });
    expect(screen.queryByText("Isi kegiatan dulu sebelum menyimpan.")).toBeNull();
    expect(activity).not.toHaveAttribute("aria-invalid");
  });

  it("keeps a failed save on screen with Coba lagi that re-sends the same payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(session()))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce(ok({ written: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    renderClient();
    fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
    fireEvent.change(screen.getByTestId("center-activity"), { target: { value: "Doa pagi" } });
    fireEvent.click(screen.getByRole("radio", { name: /^Mampu untuk Aisyah/ }));
    fireEvent.click(screen.getByTestId("center-save"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const options = toastError.mock.calls[0][1];
    expect(options).toMatchObject({ duration: Infinity, action: { label: "Coba lagi" } });

    // The teacher keeps typing; the retry still sends what failed.
    fireEvent.change(screen.getByTestId("center-activity"), { target: { value: "Lain" } });
    await act(async () => { options.action.onClick(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][1].body).toBe(fetchMock.mock.calls[1][1].body);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
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
  describe("class label, own-class default and search (R2-T-7)", () => {
    const roster = () => ({
      ...session(),
      myClassSectionIds: ["cs-a"],
      students: [
        { id: "s1", name: "Abdul Zahra", nickname: null, status: "ACTIVE", classSectionId: "cs-a", className: "TKIT A" },
        { id: "s2", name: "Abdul Zahra", nickname: null, status: "ACTIVE", classSectionId: "cs-w", className: "POPUP Weekend" },
        { id: "s3", name: "Budi", nickname: "Bud", status: "ACTIVE", classSectionId: "cs-w", className: "POPUP Weekend" },
      ],
    });

    async function open() {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(roster())));
      renderClient();
      fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
    }

    it("defaults to the teacher's own class and shows its class chip", async () => {
      await open();
      expect(screen.getByTestId("center-row-s1")).toBeInTheDocument();
      expect(screen.queryByTestId("center-row-s2")).toBeNull();
      expect(screen.queryByTestId("center-row-s3")).toBeNull();
      expect(screen.getByTestId("center-class-s1")).toHaveTextContent("TKIT A");
    });

    it("'Semua kelas' reveals everyone, and same-named children differ by class label", async () => {
      await open();
      const toggle = screen.getByTestId("center-all-classes");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("center-class-s1")).toHaveTextContent("TKIT A");
      expect(screen.getByTestId("center-class-s2")).toHaveTextContent("POPUP Weekend");
      expect(screen.getAllByText("Abdul Zahra")).toHaveLength(2);
    });

    it("filters by name (and nickname) client-side without touching the network", async () => {
      await open();
      fireEvent.click(screen.getByTestId("center-all-classes"));
      const fetchMock = vi.mocked(fetch);
      const calls = fetchMock.mock.calls.length;
      fireEvent.change(screen.getByTestId("center-student-search"), { target: { value: "bud" } });
      expect(screen.getByTestId("center-row-s3")).toBeInTheDocument();
      expect(screen.queryByTestId("center-row-s1")).toBeNull();
      fireEvent.change(screen.getByTestId("center-student-search"), { target: { value: "zzz" } });
      expect(screen.getByTestId("center-no-match")).toHaveTextContent("Tidak ada siswa dengan nama itu.");
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it("keeps unsaved levels for students hidden by the filter and does not mark the form dirty", async () => {
      await open();
      fireEvent.click(screen.getByTestId("center-all-classes"));
      fireEvent.change(screen.getByTestId("center-activity"), { target: { value: "Doa pagi" } });
      fireEvent.click(screen.getAllByRole("radio", { name: /^Mampu untuk Budi/ })[0]!);
      fireEvent.change(screen.getByTestId("center-student-search"), { target: { value: "abdul" } });
      expect(screen.queryByTestId("center-row-s3")).toBeNull();
      fireEvent.change(screen.getByTestId("center-student-search"), { target: { value: "" } });
      expect(screen.getByRole("radio", { name: /^Mampu untuk Budi/ })).toHaveAttribute("aria-checked", "true");
    });

    it("shows no filter toggle for a payload without class info (older payload)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(session())));
      renderClient();
      fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
      expect(screen.queryByTestId("center-all-classes")).toBeNull();
      expect(screen.getByTestId("center-row-student-1")).toBeInTheDocument();
    });

    it("saves entries for hidden students too (filter is view-only)", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(ok(roster()))
        .mockResolvedValueOnce(ok({ written: 1 }));
      vi.stubGlobal("fetch", fetchMock);
      renderClient();
      fireEvent.click(await screen.findByRole("button", { name: /Karakter.*Mengikuti kegiatan/ }));
      fireEvent.click(screen.getByTestId("center-all-classes"));
      fireEvent.change(screen.getByTestId("center-activity"), { target: { value: "Doa pagi" } });
      fireEvent.click(screen.getByRole("radio", { name: /^Mampu untuk Budi/ }));
      fireEvent.click(screen.getByTestId("center-all-classes")); // hide Budi again
      fireEvent.click(screen.getByTestId("center-save"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const body = JSON.parse(fetchMock.mock.calls[1]![1].body);
      expect(body.entries.map((e: { studentId: string }) => e.studentId)).toEqual(["s3"]);
    });
  });
});
