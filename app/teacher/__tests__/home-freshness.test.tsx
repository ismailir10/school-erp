import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, useState } from "react";
import { TeacherHomeClient } from "../home-client";

const refresh = vi.hoisted(() => vi.fn());
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const base = { today: "2026-11-14", userName: "Sari", todayRecord: null };
const checkedIn = { status: "PRESENT", checkInTime: "2026-11-14T00:10:00Z", checkOutTime: null, approvalStatus: "PENDING" };

function visibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  fireEvent(document, new Event("visibilitychange"));
}

beforeEach(() => {
  refresh.mockReset();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("teacher Home decision freshness", () => {
  it("polls while visible, pauses when hidden, and refreshes once on tab return", () => {
    vi.useFakeTimers();
    render(<TeacherHomeClient {...base} />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility("hidden");
    act(() => vi.advanceTimersByTime(90_000));
    fireEvent(window, new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility("visible");
    fireEvent(window, new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it.each(["APPROVED", "REJECTED"])("shows an admin %s decision after focus triggers refreshed server props", approvalStatus => {
    const { rerender } = render(<TeacherHomeClient {...base} todayRecord={checkedIn} />);
    expect(screen.getByTestId("pending-approval-chip")).toBeInTheDocument();
    refresh.mockImplementation(() => rerender(<TeacherHomeClient {...base} todayRecord={{ ...checkedIn, approvalStatus, reviewedAt: "2026-11-14T01:00:00Z", reviewNote: "Kegiatan sekolah disetujui" }} />));
    fireEvent(window, new Event("focus"));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId("attendance-decision")).toHaveTextContent(approvalStatus === "APPROVED" ? "Kehadiran disetujui admin" : "Kehadiran ditolak admin");
    expect(screen.getByTestId("attendance-decision")).toHaveTextContent("Kegiatan sekolah disetujui");
    expect(screen.queryByTestId("pending-approval-chip")).not.toBeInTheDocument();
  });

  it("does not interrupt a check-in request or a note draft, and resumes after the dialog closes", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(resolve => { resolveFetch = resolve; })));
    render(<TeacherHomeClient {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    await act(async () => {});
    vi.useFakeTimers();
    fireEvent(window, new Event("focus"));
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => resolveFetch({ ok: false, status: 422, json: async () => ({ code: "OUTSIDE_GEOFENCE", distanceMeters: null, campusName: "Taman Aster" }) }));
    fireEvent.change(screen.getByLabelText("Catatan untuk admin"), { target: { value: "Mengantar siswa ke dokter" } });
    fireEvent(window, new Event("focus"));
    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Catatan untuk admin")).toHaveValue("Mengantar siswa ke dokter");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("waits for an outstanding server refresh before requesting another", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finish!: () => void;
    let ready = false;
    const serverResponse = new Promise<void>(resolve => { finish = () => { ready = true; resolve(); }; });
    function ServerSnapshot() {
      const [version, setVersion] = useState(0);
      refresh.mockImplementation(() => setVersion(value => value + 1));
      if (version > 0 && !ready) throw serverResponse;
      return <TeacherHomeClient {...base} />;
    }
    render(<Suspense fallback={<p>Loading server response</p>}><ServerSnapshot /></Suspense>);
    fireEvent(window, new Event("focus"));
    expect(refresh).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(90_000));
    fireEvent(window, new Event("focus"));
    expect(refresh).toHaveBeenCalledOnce();
    // The transition preserves the current UI until the server has answered.
    expect(screen.getByRole("button", { name: "Catat masuk" })).toBeInTheDocument();
    expect(screen.queryByText("Loading server response")).not.toBeInTheDocument();
    await act(async () => finish());
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("removes the polling timer and both event listeners on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<TeacherHomeClient {...base} />);
    unmount();
    fireEvent(window, new Event("focus"));
    visibility("visible");
    act(() => vi.advanceTimersByTime(90_000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
