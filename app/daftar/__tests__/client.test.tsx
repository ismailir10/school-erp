import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DaftarClient from "../client";
import { DRAFT_KEY, formatAdmissionRef } from "../draft";
import { admissionDobBounds } from "@/lib/validations/admission";

const PROGRAMS = [{ id: "program_1", name: "PAUD" }];

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("formatAdmissionRef (PAR-15)", () => {
  it("returns the last 6 characters upper-cased with a #", () => {
    expect(formatAdmissionRef("cmuxyzlit0019dk7d5rxpvmdr")).toBe("#XPVMDR");
  });
});

describe("DaftarClient draft persistence (PUBX-1)", () => {
  it("restores the step and values from sessionStorage on mount", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 2,
        form: { childName: "Aisyah Putri", dateOfBirth: "2020-03-15", childGender: "P", parentName: "Ibu Fatimah" },
      }),
    );
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("daftar-step-2")).toBeInTheDocument();
    expect(screen.getByTestId("field-parent-name")).toHaveValue("Ibu Fatimah");
  });

  it("ignores a corrupt draft and starts at step 1", async () => {
    window.sessionStorage.setItem(DRAFT_KEY, "{not json");
    render(<DaftarClient programs={PROGRAMS} />);
    expect(await screen.findByTestId("daftar-step-1")).toBeInTheDocument();
    expect(screen.getByTestId("field-child-name")).toHaveValue("");
  });

  it("saves typed values and the step as the family goes", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(screen.getByTestId("field-child-name"), "Aisyah");
    await waitFor(() => {
      const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "{}");
      expect(saved.step).toBe(1);
      expect(saved.form.childName).toBe("Aisyah");
    });
  });

  it("clears the draft and shows a short reference after a successful submit", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 3,
        form: {
          childName: "Aisyah Putri",
          dateOfBirth: admissionDobBounds().max,
          childGender: "P",
          parentName: "Ibu Fatimah",
          parentPhone: "081234567890",
        },
      }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cmuxyzlit0019dk7d5rxpvmdr" }), { status: 201 }),
    );
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.click(await screen.findByTestId("daftar-submit"));

    const ref = await screen.findByTestId("confirmation-reference");
    expect(ref).toHaveTextContent("#XPVMDR");
    expect(screen.queryByText(/cmuxyzlit/)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("DaftarClient step 1 + 3 details", () => {
  it("bounds the birth-date input to the 1–8 year range (PUBX-2)", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    const input = await screen.findByTestId("field-date-of-birth");
    const { min, max } = admissionDobBounds();
    expect(input).toHaveAttribute("min", min);
    expect(input).toHaveAttribute("max", max);
  });

  it("blocks a birth date outside the range with an Indonesian message", async () => {
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.type(await screen.findByTestId("field-child-name"), "Aisyah");
    await user.type(screen.getByTestId("field-date-of-birth"), "2035-01-01");
    await user.click(screen.getByText("Perempuan"));
    await user.click(screen.getByTestId("daftar-next"));
    expect(await screen.findByText("Tanggal lahir tidak boleh di masa depan")).toBeInTheDocument();
    expect(screen.getByTestId("daftar-step-1")).toBeInTheDocument();
  });

  it("makes controls 44px tall with 16px text (PAR-4)", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    const input = await screen.findByTestId("field-child-name");
    expect(input.className).toContain("h-11");
    expect(input.className).toContain("text-base");
  });

  it("shows the gender radio as a visible control, not sr-only (PAR-5)", async () => {
    render(<DaftarClient programs={PROGRAMS} />);
    const radio = await screen.findByTestId("field-child-gender-p");
    expect(radio.className).not.toContain("sr-only");
  });

  it("links privacy and terms next to the submit button (PUBX-6)", async () => {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 3, form: {} }));
    render(<DaftarClient programs={PROGRAMS} />);
    const consent = await screen.findByTestId("daftar-consent");
    expect(consent).toHaveTextContent("Dengan mengirim, Anda menyetujui Kebijakan Privasi dan Syarat & Ketentuan.");
    expect(screen.getByRole("link", { name: "Kebijakan Privasi" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms");
  });

  it("explains why email matters (PUBX-1)", async () => {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 2, form: {} }));
    render(<DaftarClient programs={PROGRAMS} />);
    expect(
      await screen.findByText(/Isi email agar formulir pendaftaran lengkap bisa kami kirimkan\./),
    ).toBeInTheDocument();
  });

  it("tells the parent the phone format when the number is invalid (R2-P-13)", async () => {
    window.sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 2, form: { parentName: "Ibu Fatimah", parentPhone: "abc", parentWhatsapp: "xyz" } }),
    );
    const user = userEvent.setup();
    render(<DaftarClient programs={PROGRAMS} />);
    await user.click(await screen.findByTestId("daftar-next"));
    expect(await screen.findByText("Nomor telepon tidak valid. Contoh: 0812 3456 7890")).toBeInTheDocument();
    expect(screen.getByText("Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890")).toBeInTheDocument();
  });
});
