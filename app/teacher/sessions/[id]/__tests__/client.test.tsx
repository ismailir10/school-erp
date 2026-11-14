import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess, info: toastInfo },
}));

import { SessionRosterClient, type RosterRow } from "../client";

const roster: RosterRow[] = [
  {
    studentId: "s1",
    name: "Aisyah",
    nickname: null,
    status: "PRESENT",
    checkInTime: null,
    checkOutTime: null,
    pickedUpByRelation: null,
    pickedUpByName: null,
  },
  {
    studentId: "s2",
    name: "Bilal",
    nickname: "Bilal",
    status: "PRESENT",
    checkInTime: null,
    checkOutTime: null,
    pickedUpByRelation: null,
    pickedUpByName: null,
  },
];

function renderRoster(rows = roster) {
  return render(
    <SessionRosterClient
      sessionId="session_1"
      className="TK A"
      date="2026-08-03"
      slot="MORNING"
      roster={rows}
    />,
  );
}

async function chooseStatus(name: string, label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Status ${name}:`) }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: label }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

describe("SessionRosterClient", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    toastError.mockClear();
    toastSuccess.mockClear();
    toastInfo.mockClear();
  });

  it("keeps the save action clear of the navigation safe area and names its batch", () => {
    renderRoster();

    const save = screen.getByRole("button", { name: "Simpan absensi" });
    const saveArea = save.parentElement;
    expect(saveArea?.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(saveArea?.className).toContain("bg-background");
    expect(saveArea?.className).toContain("border-t");

    const status = screen.getByRole("button", {
      name: "Status Aisyah: Hadir. Pilih status.",
    });
    expect(status.className).toContain("min-h-11");
    expect(status.className).toContain("min-w-11");
    expect(status.className).toContain("focus-visible:focus-outline");
  });

  it("saves only the changed row, not the whole roster", async () => {
    let resolveSave!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const save = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveSave = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(save);
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();

    await chooseStatus("Aisyah", "Sakit");
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teacher/sessions/session_1/attendance",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      rows: [expect.objectContaining({ studentId: "s1", status: "SICK" })],
    });
    expect(screen.getByRole("button", { name: "Menyimpan absensi…" })).toBeDisabled();

    resolveSave({ ok: true, json: async () => ({ saved: 1, total: 1 }) });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Absensi tersimpan · 1 siswa", expect.anything()));
  });

  it("never sends an untouched row (TCHX-1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 1, total: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();

    // Tap masuk for Bilal only; Aisyah must stay out of the request.
    fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0]).toMatchObject({ studentId: "s2", status: "PRESENT" });
    expect(sent.rows[0].checkInTime).toEqual(expect.any(String));
  });

  it("does not POST when nothing changed and says so calmly", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();

    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith("Tidak ada perubahan untuk disimpan.");
  });

  it("treats a change that is reverted by hand as no change", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();

    await chooseStatus("Aisyah", "Sakit");
    await chooseStatus("Aisyah", "Hadir");
    expect(screen.queryByText(/Belum disimpan/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resets the baseline after a save so the next save sends only new changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 1, total: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();

    await chooseStatus("Aisyah", "Sakit");
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
    await screen.findByText("Semua perubahan tersimpan");
    expect(screen.getByRole("button", { name: "Simpan absensi" })).toBeInTheDocument();

    // Saving again with no new edit is a no-op.
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith("Tidak ada perubahan untuk disimpan.");

    // A new edit to Bilal sends Bilal only — Aisyah is no longer resent.
    await chooseStatus("Bilal", "Sakit");
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const sent = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(sent.rows).toEqual([expect.objectContaining({ studentId: "s2", status: "SICK" })]);
  });

  it("opens named choices without changing a row and Escape dismisses without an edit", async () => {
    const user = userEvent.setup();
    renderRoster();
    const trigger = screen.getByRole("button", { name: "Status Aisyah: Hadir. Pilih status." });
    await user.click(trigger);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio").map(item => item.textContent)).toEqual(["Hadir", "Sakit", "Izin", "Alpa"]);
    expect(within(menu).getByRole("menuitemradio", { name: "Hadir" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/Belum disimpan/)).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
    expect(screen.queryByText(/Belum disimpan/)).toBeNull();
  });

  it("selects any named status with the keyboard instead of cycling hidden alternatives", async () => {
    const user = userEvent.setup();
    renderRoster();
    const trigger = screen.getByRole("button", { name: /Status Aisyah:/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Hadir" })).toHaveFocus());
    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Alpa" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByRole("button", { name: "Status Aisyah: Alpa. Pilih status." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status Bilal: Hadir. Pilih status." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" })).toBeInTheDocument();
  });

  it("choosing the existing status preserves arrival and pickup data", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderRoster([{ ...roster[0], checkInTime: "2026-08-03T01:00:00.000Z", checkOutTime: "2026-08-03T05:00:00.000Z", pickedUpByRelation: "PARENT", pickedUpByName: "Ibu" }]);
    await chooseStatus("Aisyah", "Hadir");
    expect(screen.getByText(/^Masuk /)).toBeInTheDocument();
    expect(screen.getByText(/^Pulang /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides masuk, pulang and the pickup form for a child who is not Hadir (TCHX-8)", () => {
    renderRoster([{ ...roster[0], status: "ABSENT" }]);
    expect(screen.queryByRole("button", { name: "Ketuk masuk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ketuk pulang" })).toBeNull();
    expect(screen.queryByText("Dijemput oleh")).toBeNull();
  });

  it("clears unsaved masuk, pulang and pickup when status moves off Hadir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 1, total: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderRoster([
      {
        ...roster[0],
        checkInTime: "2026-08-03T01:00:00.000Z",
        checkOutTime: "2026-08-03T05:00:00.000Z",
        pickedUpByRelation: "PARENT",
        pickedUpByName: "Ibu",
      },
    ]);
    await chooseStatus("Aisyah", "Sakit"); // → Sakit
    expect(screen.queryByText(/^Masuk /)).toBeNull();
    expect(screen.queryByText("Dijemput oleh")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.rows[0]).toEqual({
      studentId: "s1",
      status: "SICK",
      checkInTime: null,
      checkOutTime: null,
      pickedUpByRelation: null,
      pickedUpByName: null,
    });
  });

  it("lets a mistapped time be cleared before saving", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderRoster();

    fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
    expect(screen.getByText(/^Masuk /)).toBeInTheDocument();
    expect(screen.getByText(/Belum disimpan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hapus jam masuk Bilal" })).toBeNull();

    const clear = screen.getByRole("button", { name: "Hapus jam masuk Aisyah" });
    expect(clear.className).toContain("tap-target");
    fireEvent.click(clear);
    expect(screen.queryByText(/^Masuk /)).toBeNull();
    // Back to the saved state — nothing left to save.
    expect(screen.queryByText(/Belum disimpan/)).toBeNull();
  });

  it("clearing pulang also drops the pickup form", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderRoster();

    fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Ketuk pulang" })[0]);
    expect(screen.getByText("Dijemput oleh")).toBeInTheDocument();
    // Masuk cannot be cleared while pulang is recorded.
    expect(screen.queryByRole("button", { name: "Hapus jam masuk Aisyah" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hapus jam pulang Aisyah" }));
    expect(screen.queryByText("Dijemput oleh")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ketuk pulang" })[0]).toBeInTheDocument();
  });

  it("keeps validation local when another pickup relation requires a name", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderRoster([
      {
        ...roster[0],
        checkInTime: "2026-08-03T01:00:00.000Z",
        checkOutTime: "2026-08-03T05:00:00.000Z",
        pickedUpByRelation: "OTHER",
        pickedUpByName: "Pak Dedi",
      },
    ]);

    // Wiping the required name makes the row changed and invalid.
    fireEvent.change(screen.getByLabelText("Nama penjemput Aisyah"), { target: { value: "" } });

    // The field says why at the field, not only in a toast that disappears.
    const name = screen.getByLabelText("Nama penjemput Aisyah");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", "pickup-name-s1-error");
    expect(screen.getByText("Wajib diisi.")).toHaveAttribute("id", "pickup-name-s1-error");

    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
    expect(toastError).toHaveBeenCalledWith(
      "Isi nama penjemput untuk Aisyah (hubungan: Lainnya).",
    );
    expect(name).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: "Pak Budi" } });
    expect(screen.queryByText("Wajib diisi.")).toBeNull();
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(name).not.toHaveAttribute("aria-describedby");
  });

  it("keeps a failed save on screen with Coba lagi that re-sends the same rows", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: 1, total: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderRoster();

    fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const [message, options] = toastError.mock.calls[0];
    expect(message).toBe("Koneksi terputus. Coba lagi sebentar ya.");
    expect(options).toMatchObject({ duration: Infinity, action: { label: "Coba lagi" } });

    options.action.onClick();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  describe("unsaved changes (TCH-2)", () => {
    const beforeUnloadPrevented = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it("stays quiet until something changes, then says so and guards reload", () => {
      vi.stubGlobal("fetch", vi.fn());
      renderRoster();
      expect(screen.queryByText(/Belum disimpan/)).toBeNull();
      expect(beforeUnloadPrevented()).toBe(false);

      fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
      expect(screen.getByText(/Belum disimpan/)).toBeInTheDocument();
      expect(beforeUnloadPrevented()).toBe(true);
    });

    it("clears the warning once the roster is saved, and warns again on the next tap", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 2, total: 2 }) }));
      renderRoster();

      fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
      fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
      await screen.findByText("Semua perubahan tersimpan");
      expect(screen.queryByText(/Belum disimpan/)).toBeNull();
      // The guard drops its beforeunload listener in an effect after the
      // clean render, so wait for it instead of racing it (flaked in CI-like
      // load: "expected true to be false").
      await waitFor(() => expect(beforeUnloadPrevented()).toBe(false));

      await chooseStatus("Bilal", "Sakit");
      expect(screen.getByText(/Belum disimpan/)).toBeInTheDocument();
    });

    it("keeps the warning when the save fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) }));
      renderRoster();
      fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
      fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(screen.getByText(/Belum disimpan/)).toBeInTheDocument();
    });

    it("asks before an in-app link throws the taps away", () => {
      vi.stubGlobal("fetch", vi.fn());
      renderRoster();
      fireEvent.click(screen.getAllByRole("button", { name: "Ketuk masuk" })[0]);
      // The back link is a real anchor in the page.
      const link = screen.getByRole("link", { name: /Beranda/ });
      const record = (event: Event) => event.preventDefault(); // jsdom cannot navigate
      document.addEventListener("click", record);
      fireEvent.click(link);
      document.removeEventListener("click", record);
      expect(screen.getByText("Keluar tanpa menyimpan?")).toBeInTheDocument();
      expect(router.push).not.toHaveBeenCalled();
    });
  });
});

describe("bulk taps", () => {
  it("Semua hadir stamps only unmarked present children and keeps exceptions", () => {
    renderRoster([
      { ...roster[0] },
      { ...roster[1], status: "SICK" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Semua hadir/ }));
    expect(screen.getAllByText(/^Masuk /)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Simpan absensi · 1 perubahan/ })).toBeInTheDocument();
  });

  it("Semua pulang marks present children picked up by Orang tua", () => {
    renderRoster();
    fireEvent.click(screen.getByRole("button", { name: /Semua pulang/ }));
    expect(screen.getAllByText(/^Pulang /)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Simpan absensi · 2 perubahan/ })).toBeInTheDocument();
  });
});


describe("unrecorded session rows", () => {
  it("stays neutral until explicitly selected and saves only that child", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: 1, total: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderRoster(roster.map(row => ({ ...row, status: "UNKNOWN" })));
    expect(screen.getAllByText("Belum dicatat")).toHaveLength(2);
    expect(screen.queryByText("Hadir", { exact: true })).toBeNull();
    await chooseStatus("Aisyah", "Hadir");
    fireEvent.click(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).rows).toEqual([expect.objectContaining({ studentId: "s1", status: "PRESENT" })]);
    expect(screen.getByText("Belum dicatat")).toBeInTheDocument();
  });
  it("explicit bulk arrival selects unknown children but preserves Sakit", () => {
    renderRoster([{ ...roster[0], status: "UNKNOWN" }, { ...roster[1], status: "SICK" }]);
    fireEvent.click(screen.getByRole("button", { name: "Semua hadir" }));
    expect(screen.getByRole("button", { name: "Status Aisyah: Hadir. Pilih status." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status Bilal: Sakit. Pilih status." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simpan absensi · 1 perubahan" })).toBeInTheDocument();
  });
});
