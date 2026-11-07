import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeacherHomeClient } from "../home-client";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const cls = { id: "class-1", name: "TK A", rosterCount: 3, attendanceRecorded: 3, slot: null, journal: { configured: true, totalStudents: 2, completeStudents: 2, completed: true, absentCount: 1 }, replies: [] };
const base = { today: "2026-09-25", userName: "Sari" };
const checkedIn = { status: "PRESENT", checkInTime: "2026-09-25T00:10:00.000Z", checkOutTime: null };
afterEach(() => vi.unstubAllGlobals());

/** Document order of the first match of each landmark. */
const position = (el: Element) => Array.from(document.body.querySelectorAll("*")).indexOf(el);

describe("check-in row placement (R2-T-1)", () => {
  it.each([["before check-in", null], ["after check-in", checkedIn]])("renders the personal row before the class card and tasks %s", (_label, todayRecord) => {
    render(<TeacherHomeClient {...base} todayRecord={todayRecord} classes={[cls]} />);
    const row = screen.getByLabelText("Kehadiran pribadi");
    expect(position(row)).toBeLessThan(position(screen.getByTestId("current-class")));
    expect(position(row)).toBeLessThan(position(screen.getByText("Yang perlu diselesaikan")));
  });
  it("keeps the row first for a teacher without a class", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    expect(position(screen.getByLabelText("Kehadiran pribadi"))).toBeLessThan(position(screen.getByText("Belum ada kelas yang ditugaskan")));
  });
});

describe("Gerbang row on Beranda", () => {
  const gateRow = () => screen.getByRole("link", { name: /Gerbang/ });
  it("sits directly below Kehadiran pribadi and opens the Gerbang page", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[cls]} gateSummary={{ total: 40, arrived: 18, pickedUp: 3 }} />);
    expect(gateRow()).toHaveAttribute("href", "/teacher/gate");
    expect(gateRow()).toHaveTextContent("Buka");
    expect(position(screen.getByLabelText("Kehadiran pribadi"))).toBeLessThan(position(gateRow()));
    expect(position(gateRow())).toBeLessThan(position(screen.getByTestId("current-class")));
  });
  it("shows today's arrived and picked-up counts", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} gateSummary={{ total: 40, arrived: 18, pickedUp: 3 }} />);
    expect(gateRow()).toHaveTextContent("18 dari 40 sudah masuk · 3 pulang");
  });
  it.each([["no children on the campus", { total: 0, arrived: 0, pickedUp: 0 }], ["a failed lookup", null]])("falls back to the plain description for %s", (_label, gateSummary) => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} gateSummary={gateSummary} />);
    expect(gateRow()).toHaveTextContent("Catat anak masuk dan pulang di gerbang");
    expect(gateRow()).not.toHaveTextContent("0 dari 0");
  });
  it("still renders when the prop is omitted", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    expect(gateRow()).toHaveTextContent("Catat anak masuk dan pulang di gerbang");
  });
});

describe("check-in failure copy (R2-T-2)", () => {
  it("maps a thrown fetch to Indonesian copy, never 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Koneksi terputus. Periksa internet, lalu coba lagi.");
    expect(alert).not.toHaveTextContent("Failed to fetch");
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeEnabled();
  });
  it("maps a raw English API error on a 500 to server copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Internal Server Error" }) }));
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Server sedang bermasalah");
    expect(alert).not.toHaveTextContent("Internal Server Error");
  });
  it("does not offer retry when the session expired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) }));
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sesi Anda sudah berakhir");
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  });
});

describe("late check-in hint (R2-T-3)", () => {
  it("says how many minutes late when the page derived them", () => {
    render(<TeacherHomeClient {...base} todayRecord={{ ...checkedIn, status: "LATE", minutesLate: 53 }} classes={[]} />);
    expect(screen.getByLabelText("Kehadiran pribadi")).toHaveTextContent("Terlambat 53 menit");
  });
  it("falls back to plain Terlambat when the minutes are unknown", () => {
    render(<TeacherHomeClient {...base} todayRecord={{ ...checkedIn, status: "LATE" }} classes={[]} />);
    const row = screen.getByLabelText("Kehadiran pribadi");
    expect(row).toHaveTextContent("Terlambat");
    expect(row).not.toHaveTextContent("menit");
  });
  it("shows nothing for an on-time record", () => {
    render(<TeacherHomeClient {...base} todayRecord={checkedIn} classes={[]} />);
    expect(screen.getByLabelText("Kehadiran pribadi")).not.toHaveTextContent("Terlambat");
  });
  it("uses minutesLate from the check-in response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "LATE", checkInTime: "2026-09-25T00:53:00.000Z", checkOutTime: null, minutesLate: 53 }) }));
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    expect(await screen.findByText(/Terlambat 53 menit/)).toBeInTheDocument();
  });
});

describe("journal task clearing (R2-T-5)", () => {
  it("shows no 'Lanjutkan jurnal harian' once every present child is complete, despite absences", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[cls]} />);
    expect(screen.queryByRole("link", { name: "Lanjutkan jurnal harian" })).toBeNull();
  });
  it("counts only present children in the open task and names the absent ones", () => {
    const open = { ...cls, journal: { configured: true, totalStudents: 2, completeStudents: 1, completed: false, absentCount: 1 } };
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[open]} />);
    expect(screen.getByText("1 dari 2 siswa lengkap · 1 tidak hadir")).toBeInTheDocument();
  });
});

describe("journal task on a hari tanpa buku penghubung", () => {
  const marked = { ...cls, journal: { configured: true, totalStudents: 3, completeStudents: 0, completed: true, absentCount: 0, dayMarkReason: "Renang" } };
  it("clears the open journal task and says why in the saved work", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[marked]} />);
    expect(screen.queryByRole("link", { name: "Lanjutkan jurnal harian" })).toBeNull();
    expect(screen.queryByText(/siswa lengkap/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pekerjaan yang sudah tersimpan" }));
    expect(screen.getByText("Hari tanpa buku penghubung · Renang")).toBeInTheDocument();
  });
});

describe("no-class teacher empty states (R2-T-12)", () => {
  it("does not point at tasks 'di atas' or 'di bawah' when there are no classes", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    expect(document.body.textContent).not.toMatch(/di atas|di bawah/);
    expect(screen.getByText("Belum ada sesi terjadwal hari ini")).toBeInTheDocument();
  });
  it("keeps the pointer to the class tasks for a teacher who has classes", () => {
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[{ ...cls, journal: null }]} />);
    expect(document.body.textContent).toMatch(/tugas kelas di atas/);
  });
});

describe("geofence note sheet", () => {
  const geo = (lat = -6.2, lng = 106.8) => vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: lat, longitude: lng, accuracy: 15 } }) } });
  it("opens the sheet on OUTSIDE_GEOFENCE, then resubmits with the note and shows the pending chip", async () => {
    geo();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ code: "OUTSIDE_GEOFENCE", distanceMeters: 312, campusName: "Taman Aster" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "PRESENT", checkInTime: "2026-09-25T00:10:00.000Z", checkOutTime: null, approvalStatus: "PENDING" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    expect(await screen.findByText("Anda ± 312 m dari Taman Aster. Tambahkan catatan agar admin dapat menyetujui.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ lat: -6.2, lng: 106.8, accuracy: 15 });
    const submit = screen.getByRole("button", { name: "Kirim untuk disetujui" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Catatan untuk admin"), { target: { value: "Antar murid ke dokter" } });
    fireEvent.click(submit);
    expect(await screen.findByTestId("pending-approval-chip")).toHaveTextContent("Menunggu persetujuan");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ note: "Antar murid ke dokter", lat: -6.2 });
  });
  it("uses the no-location copy when the distance is null", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ code: "OUTSIDE_GEOFENCE", distanceMeters: null, campusName: "Taman Aster" }) }));
    render(<TeacherHomeClient {...base} todayRecord={null} classes={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Catat masuk" }));
    expect(await screen.findByText("Lokasi tidak terbaca. Tambahkan catatan agar admin dapat menyetujui.")).toBeInTheDocument();
  });
});
