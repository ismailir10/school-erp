import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GateClient, type GateStudent } from "../client";
const fetchMock = vi.fn();
const child = (studentId: string, available: boolean): GateStudent => ({
  studentId, available, name: studentId, nickname: null, classSectionId: "c1", className: "TK A",
  status: null, checkInTime: null, checkOutTime: null, pickedUpByRelation: null, pickedUpByName: null,
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ campuses: [{ id: "campus", name: "Sekolah" }], campusId: "campus", students: [child("Aisyah", false), child("Bilal", true)] }) });
});
describe("Gate availability", () => {
  it("explains no session and blocks arrival and pickup without posting", async () => {
    render(<GateClient />);
    const unavailable = await screen.findByRole("button", { name: "Masuk: Aisyah, TK A" });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveTextContent("Tidak ada sesi kelas hari ini");
    expect(screen.getByRole("button", { name: "Masuk: Bilal, TK A" })).toBeEnabled();
    fireEvent.click(unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Pulang" }));
    expect(screen.getByRole("button", { name: "Pulang: Aisyah, TK A" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Ubah penjemput Aisyah" })).toBeNull();
  });
  it("names the pickup consequence before recording departure", async () => {
    render(<GateClient />);
    await screen.findByRole("button", { name: "Masuk: Bilal, TK A" });
    fireEvent.click(screen.getByRole("button", { name: "Pulang" }));
    fireEvent.click(screen.getByRole("button", { name: "Ubah penjemput Bilal" }));
    expect(screen.getByText("Catat kepulangan Bilal")).toBeInTheDocument();
    expect(screen.getByText("Memilih penjemput langsung mencatat jam pulang sekarang.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Catat pulang" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nama penjemput lainnya"), { target: { value: "Pak Dedi" } });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ time: "2026-11-14T08:00:00Z" }) });
    fireEvent.click(screen.getByRole("button", { name: "Catat pulang" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: "pickup", relation: "OTHER", name: "Pak Dedi" });
  });
  it("still sends a scheduled arrival and retains campus context", async () => {
    render(<GateClient />);
    const available = await screen.findByRole("button", { name: "Masuk: Bilal, TK A" });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ time: "2026-11-14T01:00:00Z" }) });
    fireEvent.click(available);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ studentId: "Bilal", campusId: "campus", action: "arrive" });
  });
});
