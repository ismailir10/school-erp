import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DaftarClient from "../client";
import { DRAFT_KEY, formatAdmissionRef } from "../draft";
import { admissionDobBounds } from "@/lib/validations/admission";

const PROGRAMS = [{ id: "program_1", name: "PAUD" }];

/** A plausible toddler birth date (3 years ago) as YYYY-MM-DD, built from today. */
function threeYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function okFetch(id = "cmuxyzlit0019dk7d5rxpvmdr") {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ id }), { status: 201 }));
}

function sentBody(spy: ReturnType<typeof okFetch>) {
  return JSON.parse(String(spy.mock.calls[0][1]?.body));
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("formatAdmissionRef (PAR-15)", () => {
  it("returns the last 6 characters upper-cased with a #", () => {
    expect(formatAdmissionRef("cmuxyzlit0019dk7d5rxpvmdr")).toBe("#XPVMDR");
  });
});

describe("DaftarClient — one short page", () => {
  it("shows the parent fields and one submit button, with no stepper", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("field-parent-name")).toBeInTheDocument();
    expect(screen.getByTestId("field-parent-relationship")).toBeInTheDocument();
    expect(screen.getByTestId("field-parent-phone")).toBeInTheDocument();
    expect(screen.getByTestId("field-parent-email")).toBeInTheDocument();
    expect(screen.getByTestId("field-notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kirim Pertanyaan" })).toBeInTheDocument();
    expect(screen.queryByTestId("daftar-next")).not.toBeInTheDocument();
    expect(screen.queryByText("Preferensi")).not.toBeInTheDocument();
  });

  it("keeps the child block collapsed until asked", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("daftar-child-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("field-child-name")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("daftar-child-toggle"));
    expect(await screen.findByTestId("field-child-name")).toBeInTheDocument();
    expect(screen.getByTestId("field-date-of-birth")).toBeInTheDocument();
    expect(screen.getByTestId("field-program-id")).toBeInTheDocument();
  });

  it("hides the program choice when no program is active", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={[]} />);
    await user.click(await screen.findByTestId("daftar-child-toggle"));
    expect(await screen.findByTestId("field-child-name")).toBeInTheDocument();
    expect(screen.queryByTestId("field-program-id")).not.toBeInTheDocument();
  });

  it("explains that one contact is enough and why email helps (PUBX-1)", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    const hint = await screen.findByTestId("daftar-contact-hint");
    expect(hint).toHaveTextContent("Isi salah satu atau keduanya.");
    expect(hint).toHaveTextContent("Dengan email, formulir pendaftaran bisa langsung kami kirimkan.");
  });

  it("makes controls 44px tall with 16px text (PAR-4)", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    const input = await screen.findByTestId("field-parent-name");
    expect(input.className).toContain("h-11");
    expect(input.className).toContain("text-base");
  });

  it("links privacy and terms next to the submit button (PUBX-6)", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    const consent = await screen.findByTestId("daftar-consent");
    expect(consent).toHaveTextContent("Dengan mengirim, Anda menyetujui Kebijakan Privasi dan Syarat & Ketentuan.");
    expect(screen.getByRole("link", { name: "Kebijakan Privasi" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms");
  });

  it("shows the gender radio as a visible control, not sr-only (PAR-5)", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.click(await screen.findByTestId("daftar-child-toggle"));
    const radio = await screen.findByTestId("field-child-gender-p");
    expect(radio.className).not.toContain("sr-only");
  });
});

describe("DaftarClient — submit", () => {
  it("sends only the parent name and phone when nothing else is filled", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-phone"), "0812-3456-7890");
    await user.click(screen.getByTestId("daftar-submit"));

    expect(await screen.findByTestId("daftar-confirmation")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchSpy)).toEqual({ parentName: "Ibu Fatimah", parentPhone: "0812-3456-7890" });
    expect(screen.getByTestId("confirmation-parent-name")).toHaveTextContent("Ibu Fatimah");
    expect(screen.getByTestId("confirmation-reference")).toHaveTextContent("#XPVMDR");
    expect(screen.queryByText(/cmuxyzlit/)).not.toBeInTheDocument();
  });

  it("accepts an email alone and mentions the confirmation email", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-email"), "fatimah@example.com");
    await user.click(screen.getByTestId("daftar-submit"));

    expect(await screen.findByTestId("daftar-confirmation")).toHaveTextContent("email");
    expect(sentBody(fetchSpy)).toEqual({ parentName: "Ibu Fatimah", parentEmail: "fatimah@example.com" });
  });

  it("includes the child block, relationship and notes when filled", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Pak Umar");
    await user.selectOptions(screen.getByTestId("field-parent-relationship"), "AYAH");
    await user.type(screen.getByTestId("field-parent-phone"), "081234567890");
    await user.click(screen.getByTestId("daftar-child-toggle"));
    await user.type(await screen.findByTestId("field-child-name"), "Aisyah");
    const dob = threeYearsAgo();
    await user.type(screen.getByTestId("field-date-of-birth"), dob);
    await user.click(screen.getByText("Perempuan"));
    await user.selectOptions(screen.getByTestId("field-program-id"), "program_1");
    await user.type(screen.getByTestId("field-notes"), "Ingin tahu biaya");
    await user.click(screen.getByTestId("daftar-submit"));

    await screen.findByTestId("daftar-confirmation");
    expect(sentBody(fetchSpy)).toEqual({
      parentName: "Pak Umar",
      parentRelationship: "AYAH",
      parentPhone: "081234567890",
      childName: "Aisyah",
      dateOfBirth: dob,
      childGender: "P",
      programId: "program_1",
      notes: "Ingin tahu biaya",
    });
  });

  it("asks for a contact inline and sends nothing when there is none", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.click(screen.getByTestId("daftar-submit"));

    expect(await screen.findByTestId("error-contact")).toHaveTextContent(
      "Isi minimal satu: No. HP/WhatsApp atau email.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("daftar-confirmation")).not.toBeInTheDocument();

    // Typing into either contact field takes the message away.
    await user.type(screen.getByTestId("field-parent-phone"), "0");
    expect(screen.queryByTestId("error-contact")).not.toBeInTheDocument();
  });

  it("links each shown error to its input and moves focus to the first one", async () => {
    okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.click(await screen.findByTestId("daftar-submit"));

    const name = screen.getByTestId("field-parent-name");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-describedby", "parentName-error");
    expect(document.getElementById("parentName-error")).toHaveTextContent("Nama orang tua wajib diisi");

    const phone = screen.getByTestId("field-parent-phone");
    expect(phone.getAttribute("aria-describedby")).toBe("contact-error contact-hint");
    expect(screen.getByTestId("field-parent-email").getAttribute("aria-describedby")).toBe("contact-error contact-hint");
    expect(document.getElementById("contact-error")).toHaveTextContent("Isi minimal satu");
  });

  it("keeps only the hint on a contact field without an error", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("field-parent-phone")).toHaveAttribute("aria-describedby", "contact-hint");
  });

  it("opens the child block and focuses the field when the error is inside it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "validation_failed", fields: { childName: "Nama anak terlalu panjang" } }), {
        status: 400,
      }),
    );
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-phone"), "081234567890");
    await user.click(screen.getByTestId("daftar-submit"));
    const child = await screen.findByTestId("field-child-name");
    await waitFor(() => expect(child).toHaveFocus());
    expect(child).toHaveAttribute("aria-describedby", "childName-error");
  });

  it("asks for the parent name inline", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-phone"), "081234567890");
    await user.click(screen.getByTestId("daftar-submit"));
    expect(await screen.findByText("Nama orang tua wajib diisi")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells the parent the phone format when the number is invalid (R2-P-13)", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-phone"), "abc");
    await user.click(screen.getByTestId("daftar-submit"));
    expect(await screen.findByText("Nomor telepon tidak valid. Contoh: 0812 3456 7890")).toBeInTheDocument();
    expect(screen.queryByTestId("error-contact")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a malformed email", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-email"), "bukan-email");
    await user.click(screen.getByTestId("daftar-submit"));
    expect(await screen.findByText("Email tidak valid")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens the child block and names the problem when the birth date is out of range (PUBX-2)", async () => {
    const fetchSpy = okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-phone"), "081234567890");
    await user.click(screen.getByTestId("daftar-child-toggle"));
    await user.type(await screen.findByTestId("field-date-of-birth"), "2035-01-01");
    await user.click(screen.getByTestId("daftar-child-toggle")); // collapse again
    await user.click(screen.getByTestId("daftar-submit"));
    expect(await screen.findByText("Tanggal lahir tidak boleh di masa depan")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bounds the birth-date input to the 1–8 year range (PUBX-2)", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.click(await screen.findByTestId("daftar-child-toggle"));
    const input = await screen.findByTestId("field-date-of-birth");
    const { min, max } = admissionDobBounds();
    expect(input).toHaveAttribute("min", min);
    expect(input).toHaveAttribute("max", max);
  });

  it("shows server-side field errors and keeps what was typed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "validation_failed", fields: { parentPhone: "Nomor telepon tidak valid. Contoh: 0812 3456 7890" } }),
        { status: 400 },
      ),
    );
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-phone"), "081234567890");
    await user.click(screen.getByTestId("daftar-submit"));
    expect(await screen.findByTestId("daftar-global-error")).toHaveTextContent("Mohon periksa kembali isian yang ditandai.");
    expect(screen.getByTestId("field-parent-name")).toHaveValue("Ibu Fatimah");
  });

  it("explains a rate limit in plain words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }));
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu Fatimah");
    await user.type(screen.getByTestId("field-parent-phone"), "081234567890");
    await user.click(screen.getByTestId("daftar-submit"));
    expect(await screen.findByTestId("daftar-global-error")).toHaveTextContent("Terlalu banyak permintaan");
  });
});

describe("DaftarClient draft persistence (PUBX-1)", () => {
  it("restores values from sessionStorage and opens the child block when it holds data", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ form: { parentName: "Ibu Fatimah", childName: "Aisyah Putri", childGender: "P" } }),
    );
    render(<DaftarClient programs={PROGRAMS} />);
    await waitFor(() => expect(screen.getByTestId("field-parent-name")).toHaveValue("Ibu Fatimah"));
    expect(await screen.findByTestId("field-child-name")).toHaveValue("Aisyah Putri");
  });

  it("uses a v2 key and ignores a leftover v1 draft without crashing", async () => {
    expect(DRAFT_KEY).toBe("daftar-draft-v2");
    window.sessionStorage.setItem(
      "daftar-draft-v1",
      JSON.stringify({ step: 3, form: { childName: "Lama", parentName: "Ibu Lama", parentPhone: "0811" } }),
    );
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("field-parent-name")).toHaveValue("");
    expect(screen.getByTestId("daftar-child-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("ignores a corrupt draft and starts empty", async () => {
    window.sessionStorage.setItem(DRAFT_KEY, "{not json");
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("field-parent-name")).toHaveValue("");
  });

  it("ignores a draft with an unknown relationship value", async () => {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form: { parentName: "Ibu", parentRelationship: "PAMAN" } }));
    render(<DaftarClient programs={PROGRAMS} />);
    await waitFor(() => expect(screen.getByTestId("field-parent-name")).toHaveValue("Ibu"));
    expect(screen.getByTestId("field-parent-relationship")).toHaveValue("");
  });

  it("saves typed values as the family goes", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-parent-name"), "Ibu");
    await waitFor(() => {
      const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "{}");
      expect(saved.form.parentName).toBe("Ibu");
    });
  });

  it("clears the draft after a successful submit", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ form: { parentName: "Ibu Fatimah", parentPhone: "081234567890" } }),
    );
    okFetch();
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await waitFor(() => expect(screen.getByTestId("field-parent-name")).toHaveValue("Ibu Fatimah"));
    await user.click(screen.getByTestId("daftar-submit"));
    await screen.findByTestId("daftar-confirmation");
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
