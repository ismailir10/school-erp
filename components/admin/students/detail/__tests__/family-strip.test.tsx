import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FamilyContactStrip } from "../family-strip";
import type { Guardian } from "../types";

function guardian(over: { phone?: string | null; whatsapp?: string | null; isPrimary?: boolean; relationship?: string } = {}): Guardian {
  return {
    id: "sg1",
    relationship: over.relationship ?? "IBU",
    isPrimary: over.isPrimary ?? true,
    childOrder: null,
    status: "ACTIVE",
    parent: {
      id: "p1",
      name: "Fatimah Rahman",
      phone: over.phone === undefined ? "0812-5550-1234" : over.phone,
      whatsapp: over.whatsapp === undefined ? null : over.whatsapp,
      email: null,
      nik: null,
      education: null,
      occupation: null,
      employer: null,
      employerAddress: null,
      employerCity: null,
      incomeRange: null,
      childrenTotal: null,
      address: null,
      hasKtp: true,
      hasKk: true,
    },
  } as Guardian;
}

describe("FamilyContactStrip", () => {
  it("shows name, relationship, number and the contact buttons", () => {
    render(<FamilyContactStrip guardian={guardian()} guardianCount={2} onSeeAll={() => {}} />);
    const region = screen.getByRole("region", { name: "Kontak keluarga" });
    expect(region).toHaveTextContent("Fatimah Rahman");
    expect(region).toHaveTextContent("Ibu · Wali utama");
    expect(screen.getByText("0812-5550-1234").className).toContain("font-currency");
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/6281255501234");
    expect(screen.getByRole("link", { name: "Telepon" })).toHaveAttribute("href", "tel:081255501234");
  });

  it("does not call a non-primary wali the utama", () => {
    render(<FamilyContactStrip guardian={guardian({ isPrimary: false, relationship: "AYAH" })} guardianCount={1} onSeeAll={() => {}} />);
    expect(screen.getByRole("region", { name: "Kontak keluarga" })).toHaveTextContent("Ayah");
    expect(screen.getByRole("region", { name: "Kontak keluarga" })).not.toHaveTextContent("Wali utama");
  });

  it("jumps to the full list through a 44px button that names the count", async () => {
    const user = userEvent.setup();
    const onSeeAll = vi.fn();
    render(<FamilyContactStrip guardian={guardian()} guardianCount={3} onSeeAll={onSeeAll} />);
    const button = screen.getByRole("button", { name: "3 wali · Lihat semua" });
    expect(button.className).toContain("tap-target");
    await user.click(button);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("shows no dead buttons for a number that cannot be dialled", () => {
    render(<FamilyContactStrip guardian={guardian({ phone: "12", whatsapp: null })} guardianCount={1} onSeeAll={() => {}} />);
    expect(screen.queryByRole("link", { name: "WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Telepon" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 wali · Lihat semua" })).toBeInTheDocument();
  });

  it("shows no number line when the wali has none", () => {
    render(<FamilyContactStrip guardian={guardian({ phone: null, whatsapp: null })} guardianCount={1} onSeeAll={() => {}} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector(".font-currency")).toBeNull();
  });

  it("uses the WhatsApp number for the chat even when the phone differs", () => {
    render(<FamilyContactStrip guardian={guardian({ phone: "0812-5550-1234", whatsapp: "0899-1111-2222" })} guardianCount={1} onSeeAll={() => {}} />);
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/6289911112222");
  });

  it("renders nothing without a wali", () => {
    const { container } = render(<FamilyContactStrip guardian={null} guardianCount={0} onSeeAll={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
