import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeluargaSection } from "../keluarga-section";
import type { Student } from "../types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

// The real picker is an async combobox (covered by parent-picker.test.tsx);
// here it only needs to hand the dialog a chosen wali.
vi.mock("@/components/admin/parent-picker", () => ({
  ParentPicker: ({ onSelect }: { onSelect: (p: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({ id: "p-fajar", name: "Fajar Ramadhani", phone: null, email: null, childCount: 1 })}
    >
      Pilih Fajar
    </button>
  ),
}));

const student: Student = {
  id: "s1", name: "Anak", nickname: null, dateOfBirth: null, gender: null, address: null, notes: null,
  metadata: null, status: "ACTIVE", nis: null, nisn: null, birthPlace: null, nik: null, kkNumber: null,
  livingWith: null, photoUrl: null, createdAt: null, withdrawalReason: null, withdrawalDate: null,
  graduationDate: null, guardians: [], enrollments: [],
};

async function openLinkDialog() {
  const user = userEvent.setup();
  render(<KeluargaSection student={student} studentId="s1" open onOpenChange={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole("button", { name: /Tambah/ }));
  await user.click(await screen.findByRole("button", { name: "Pilih Fajar" }));
  return user;
}

describe("KeluargaSection — Tautkan Wali relationship (R2-ADMIN-6)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not pre-select Ibu: the select shows a placeholder and Tautkan Wali stays disabled", async () => {
    await openLinkDialog();
    const trigger = screen.getByRole("combobox", { name: /Hubungan/ });
    expect(trigger).toHaveTextContent("Pilih hubungan");
    expect(trigger).not.toHaveTextContent("Ibu");
    expect(screen.getByRole("button", { name: "Tautkan Wali" })).toBeDisabled();
  });

  it("links with the relationship the admin picked", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchFn);
    const user = await openLinkDialog();

    await user.click(screen.getByRole("combobox", { name: /Hubungan/ }));
    await user.click(await screen.findByRole("option", { name: "Ayah" }));
    const submit = screen.getByRole("button", { name: "Tautkan Wali" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/students/s1/guardians");
    expect(JSON.parse(String(init.body))).toMatchObject({ parentId: "p-fajar", relationship: "AYAH" });
  });
});
