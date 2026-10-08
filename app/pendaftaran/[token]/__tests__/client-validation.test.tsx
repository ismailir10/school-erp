/**
 * Public enrollment form: select labels, contact-format validation on Lanjut,
 * resume step, stepper, rejected-submit mapping and the PAR-4 / PUBX-7 polish.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label }: { label: string }) => <div>{label}</div>,
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
  consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
  documents: {},
};

const empty = {
  programId: null,
  dcareAddon: false,
  studentData: {},
  ayahData: {},
  ibuData: {},
  consentData: {},
  documents: {},
};

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

const lanjut = () => screen.getByRole("button", { name: "Lanjut" });

describe("PendaftaranClient: labels (PAR-2)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("every select on Data Anak is reachable by its label", () => {
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={filled} />);
    for (const [name, value] of [
      [/^Jenis kelamin/, "P"],
      [/^Agama/, "ISLAM"],
      [/^Kewarganegaraan/, "WNI"],
      [/^Tinggal bersama/, ""],
    ] as const) {
      const select = screen.getByLabelText(name);
      expect(select.tagName).toBe("SELECT");
      expect(select).toHaveValue(value);
    }
    expect(screen.getByLabelText(/^Jenis kelamin/)).toHaveAttribute("aria-required", "true");
  });

  it("parent selects and the textarea are labelled too", async () => {
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={filled} />);
    for (const name of [/^Agama/, /^Pendidikan terakhir/, /^Pekerjaan/, /^Penghasilan/]) {
      expect(screen.getByLabelText(name).tagName).toBe("SELECT");
    }
    expect(screen.getByLabelText("Alamat kantor").tagName).toBe("TEXTAREA");
  });

  it("the program select is labelled", () => {
    render(<PendaftaranClient initialStep={3} token="tok" programs={programs} prefill={filled} />);
    expect(screen.getByLabelText(/^Program/)).toHaveValue("p-1");
  });
});

describe("PendaftaranClient: phone/email checked on Lanjut (PAR-6 / PUBX-3)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("blocks Lanjut on Ayah, shows the message under each bad field and focuses the first", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={filled} />);
    await user.type(screen.getByLabelText("No. HP"), "abc");
    await user.type(screen.getByLabelText("Email"), "bukan-email");

    await user.click(lanjut());

    expect(screen.getByRole("heading", { name: "Data Ayah" })).toBeInTheDocument();
    const phone = screen.getByLabelText("No. HP");
    const email = screen.getByLabelText("Email");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(/Nomor HP belum benar/);
    expect(email).toHaveAccessibleDescription(/Alamat email belum benar/);
    expect(phone).toHaveFocus();
    // Nothing was autosaved for the invalid step.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("clears each message as soon as the value is corrected, then lets Lanjut through", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={filled} />);
    await user.type(screen.getByLabelText("No. HP"), "abc");
    await user.click(lanjut());
    expect(screen.getByLabelText("No. HP")).toHaveAttribute("aria-invalid", "true");

    await user.clear(screen.getByLabelText("No. HP"));
    await user.type(screen.getByLabelText("No. HP"), "0812 3456 7890");
    expect(screen.getByLabelText("No. HP")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Nomor HP belum benar/)).not.toBeInTheDocument();

    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ibu" })).toBeInTheDocument();
  });

  it("does the same for Ibu and for the office phone", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={2} token="tok" programs={programs} prefill={filled} />);
    await user.type(screen.getByLabelText("Telepon kantor"), "kantor");
    await user.click(lanjut());
    expect(screen.getByLabelText("Telepon kantor")).toHaveAccessibleDescription(/Telepon kantor belum benar/);
    expect(screen.getByLabelText("Telepon kantor")).toHaveFocus();
  });

  it("the step alert follows the fixes instead of going stale", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={{ ...filled, ayahData: {} }} />);
    await user.click(lanjut());
    expect(screen.getByText("Nama ayah wajib diisi.")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Nama \*/), "Budi");
    expect(screen.queryByText("Nama ayah wajib diisi.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("PendaftaranClient: resume (PUBX-4) and stepper", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("opens an empty draft on Data Anak", () => {
    render(<PendaftaranClient token="tok" programs={programs} prefill={empty} />);
    expect(screen.getByRole("heading", { name: "Data Anak" })).toBeInTheDocument();
  });

  it("opens a half-finished draft on the first step that still lacks required data", () => {
    render(
      <PendaftaranClient
        token="tok"
        programs={programs}
        prefill={{ ...filled, ibuData: {}, programId: null, consentData: {} }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Data Ibu" })).toBeInTheDocument();
  });

  it("opens a finished draft on Tinjau", () => {
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    expect(screen.getByRole("heading", { name: "Tinjau & Kirim" })).toBeInTheDocument();
  });

  it("makes reached steps tappable and leaves later ones inert", async () => {
    const user = userEvent.setup();
    render(
      <PendaftaranClient token="tok" programs={programs} prefill={{ ...filled, programId: null, consentData: {} }} />,
    );
    // Resumed on Program (step 4 of 7).
    expect(screen.getByRole("heading", { name: "Pilihan Program" })).toBeInTheDocument();
    expect(screen.getByText("4. Program").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("button", { name: "5. Berkas" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "2. Data Ayah" }));
    expect(screen.getByRole("heading", { name: "Data Ayah" })).toBeInTheDocument();
    // Having gone back, the furthest step stays reachable.
    expect(screen.getByRole("button", { name: "4. Program" })).toBeInTheDocument();
  });
});

describe("PendaftaranClient: rejected submit names the step", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("422 on a field maps to 'Langkah 2 · Data Ayah — …' with a way back to that step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/submit")
          ? Promise.resolve({
              ok: false,
              status: 422,
              json: async () => ({ error: "validation_failed", fields: { "ayahData.phone": "Nomor telepon tidak valid" } }),
            } as Response)
          : ok({}),
      ),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);

    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));

    expect(await screen.findByText(/Langkah 2 · Data Ayah — Nomor telepon tidak valid/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Buka langkah 2" }));
    expect(screen.getByRole("heading", { name: "Data Ayah" })).toBeInTheDocument();
    expect(screen.queryByText(/Langkah 2 · Data Ayah — Nomor telepon/)).not.toBeInTheDocument();
  });

  it("a bad saved phone is caught locally on Kirim, names the parent and flags the field after the jump", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    const user = userEvent.setup();
    render(
      <PendaftaranClient
        initialStep={6}
        token="tok"
        programs={programs}
        prefill={{ ...filled, ibuData: { name: "Siti", phone: "abc" } }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/Langkah 3 · Data Ibu — Nomor HP belum benar/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith("/submit"))).toBe(false);

    await user.click(within(alert).getByRole("button", { name: "Buka langkah 3" }));
    expect(screen.getByLabelText("No. HP")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("PendaftaranClient: public-form polish (PAR-4, PUBX-6, PUBX-7)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => ok({})));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("controls and primary buttons are 44px with 16px text", () => {
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={filled} />);
    expect(screen.getByLabelText(/^Nama lengkap/).className).toMatch(/\bh-11\b/);
    expect(screen.getByLabelText(/^Jenis kelamin/).className).toMatch(/\bh-11\b.*\btext-base\b/);
    expect(lanjut().className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("button", { name: "Kembali" }).className).toMatch(/\bh-11\b/);
  });

  it("links to Kebijakan Privasi and Ketentuan in a new tab", () => {
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={filled} />);
    const privacy = screen.getByRole("link", { name: "Kebijakan Privasi" });
    const terms = screen.getByRole("link", { name: "Syarat & Ketentuan" });
    expect(privacy).toHaveAttribute("href", "/legal/privacy");
    expect(terms).toHaveAttribute("href", "/legal/terms");
    expect(privacy).toHaveAttribute("target", "_blank");
  });

  it("states the consent once, with a 20px checkbox", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={filled} />);
    expect(screen.queryByText(/Kami sudah membaca dan memahami dengan baik/)).not.toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: /Kami sudah membaca, memahami, dan menyetujui/ });
    expect(box.className).toMatch(/\bsize-5\b/);
  });
});
