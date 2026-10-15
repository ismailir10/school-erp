import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeluargaSection } from "../keluarga-section";
import type { Student } from "../types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const parent = (id: string, name: string) => ({
  id, name, email: null, phone: null, whatsapp: null, address: null, status: "ACTIVE",
  nik: null, education: null, occupation: null, employer: null, employerAddress: null,
  employerCity: null, incomeRange: null, childrenTotal: null, hasKtp: false, hasKk: false,
});

function student(guardians: Student["guardians"]): Student {
  return {
    id: "s1", canEdit: true, name: "Anak", nickname: null, dateOfBirth: null, gender: null, address: null, notes: null,
    metadata: null, status: "ACTIVE", nis: null, nisn: null, birthPlace: null, nik: null, kkNumber: null,
    livingWith: null, photoUrl: null, createdAt: null, withdrawalReason: null, withdrawalDate: null,
    graduationDate: null, guardians, enrollments: [],
  };
}

const ayah = { id: "g1", relationship: "AYAH", isPrimary: true, childOrder: null, status: "ACTIVE", parent: parent("p1", "Pak Budi") };
const ibu = { id: "g2", relationship: "IBU", isPrimary: false, childOrder: null, status: "ACTIVE", parent: parent("p2", "Bu Sari") };

function renderSection(guardians: Student["guardians"]) {
  return render(
    <KeluargaSection student={student(guardians)} studentId="s1" open onOpenChange={() => {}} onSaved={() => {}} />,
  );
}

describe("KeluargaSection — deactivating the primary guardian (CORE-4)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks who becomes primary when another active guardian exists, and sends the choice", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ promotedPrimary: { id: "g2", name: "Bu Sari" } }) }) as Response);
    vi.stubGlobal("fetch", fetchFn);
    const user = userEvent.setup();
    renderSection([ayah, ibu] as Student["guardians"]);

    await user.click(screen.getByRole("button", { name: "Nonaktifkan wali Pak Budi" }));
    expect(await screen.findByText(/Ini wali utama siswa/)).toBeInTheDocument();
    expect(screen.getByText("Wali utama pengganti")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nonaktifkan" }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/guardians/g1");
    expect(JSON.parse(String(init.body))).toEqual({ status: "INACTIVE", newPrimaryId: "g2" });
  });

  it("warns explicitly when the primary is the only active guardian", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    renderSection([ayah] as Student["guardians"]);

    await user.click(screen.getByRole("button", { name: "Nonaktifkan wali Pak Budi" }));
    expect(await screen.findByText("Tidak ada wali aktif lain")).toBeInTheDocument();
    expect(screen.queryByText("Wali utama pengganti")).not.toBeInTheDocument();
  });

  it("keeps the plain copy for a non-primary guardian", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    renderSection([ayah, ibu] as Student["guardians"]);

    await user.click(screen.getByRole("button", { name: "Nonaktifkan wali Bu Sari" }));
    expect(await screen.findByText(/Wali tidak akan ditampilkan/)).toBeInTheDocument();
    expect(screen.queryByText("Wali utama pengganti")).not.toBeInTheDocument();
  });
});
