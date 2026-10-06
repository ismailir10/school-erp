/**
 * Public enrollment form — signature handover note, the Berkas step wiring and
 * the autosave stale-closure fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label, saved }: { label: string; saved: boolean }) => (
    <div>{`${label}: ${saved ? "tersimpan" : "kosong"}`}</div>
  ),
}));

const programs = [{ id: "p-1", name: "TK A" }];

const filled = {
  programId: "p-1",
  dcareAddon: false,
  studentData: {
    childName: "Aisyah",
    childGender: "P",
    birthPlace: "Bogor",
    dateOfBirth: "2021-01-01",
    agama: "ISLAM",
    kewarganegaraan: "WNI",
  },
  ayahData: { name: "Budi" },
  ibuData: { name: "Siti" },
  consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: false } },
  documents: {},
};

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

async function gotoConsent(user: ReturnType<typeof userEvent.setup>) {
  // Data Anak -> Ayah -> Ibu -> Program -> Berkas -> Persetujuan
  for (let i = 0; i < 5; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
}

describe("PendaftaranClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("has the Berkas step between Program and Persetujuan", () => {
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    const labels = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(labels).toEqual([
      "1. Data Anak",
      "2. Data Ayah",
      "3. Data Ibu",
      "4. Program",
      "5. Berkas",
      "6. Persetujuan",
      "7. Tinjau",
    ]);
  });

  it("shows a handover note when only one parent has signed, without blocking Lanjut copy", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    expect(screen.getByText("Tanda tangan Ibu belum ada")).toBeInTheDocument();
    expect(screen.getByText("Tanda tangan Ayah: tersimpan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salin link/ })).toBeInTheDocument();

    // Lanjut still requires both signatures.
    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.getByText("Tanda tangan ibu wajib disimpan.")).toBeInTheDocument();
  });

  it("'Periksa lagi' re-reads signature status and clears the note once both exist", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature") ? ok({ ayah: true, ibu: true }) : ok({}),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    await waitFor(() => expect(screen.queryByText("Tanda tangan Ibu belum ada")).not.toBeInTheDocument());
    expect(screen.getByText("Tanda tangan Ibu: tersimpan")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === "/api/enrollments/token/tok/signature")).toBe(true);
  });

  it("says so when nothing changed", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature") ? ok({ ayah: true, ibu: false }) : ok({}),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    expect(await screen.findByText("Belum ada tanda tangan baru.")).toBeInTheDocument();
  });

  it("autosave sends the latest typed value and never signature tokens", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);

    const name = screen.getByLabelText(/^Nama lengkap/);
    await user.clear(name);
    await user.type(name, "Zahra");

    await waitFor(
      () => {
        const patches = vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
        expect(patches).toHaveLength(1);
      },
      { timeout: 4000 },
    );
    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")!;
    const body = JSON.parse((patch[1] as RequestInit).body as string);
    expect(body.studentData.childName).toBe("Zahra");
    expect(body.consentData.ayah).toEqual({ name: "Budi" });
    expect(JSON.stringify(body)).not.toMatch(/signatureToken/);
  });

  it("flushes a pending autosave with keepalive when the page is hidden", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);

    const name = screen.getByLabelText(/^Nama lengkap/);
    await user.clear(name);
    await user.type(name, "Zahra");
    fireEvent(window, new Event("pagehide"));

    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")!;
    expect(patch).toBeTruthy();
    expect((patch[1] as RequestInit).keepalive).toBe(true);
    expect(JSON.parse((patch[1] as RequestInit).body as string).studentData.childName).toBe("Zahra");
  });

  it("fills an empty name from the server but never overwrites a typed one", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature")
        ? ok({ ayah: true, ibu: false, ayahName: "Nama Server", ibuName: "Siti Server" })
        : ok({}),
    );
    const user = userEvent.setup();
    const prefill = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "", signed: false } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={prefill} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    expect(await screen.findByText("Tanda tangan terbaru sudah dimuat.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nama jelas Ibu/)).toHaveValue("Siti Server");
    expect(screen.getByLabelText(/^Nama jelas Ayah/)).toHaveValue("Budi");
  });

  it("moves focus to the live status line when the note unmounts after 'Periksa lagi'", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/signature") ? ok({ ayah: true, ibu: true }) : ok({}),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await gotoConsent(user);

    await user.click(screen.getByRole("button", { name: /Periksa lagi/ }));

    const status = await screen.findByText("Tanda tangan terbaru sudah dimuat.");
    expect(document.activeElement).toBe(status);
  });

  it("keeps the latest edits in the draft when submit fails", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/submit") ? Promise.reject(new Error("offline")) : ok({}),
    );
    const user = userEvent.setup();
    const both = {
      ...filled,
      consentData: { agreed: true, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient token="tok" programs={programs} prefill={both} />);
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    vi.mocked(fetch).mockClear();

    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));

    await waitFor(
      () => expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit)?.method === "PATCH")).toBe(true),
      { timeout: 4000 },
    );
  });
});
