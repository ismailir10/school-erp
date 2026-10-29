import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { SectionCard } from "@/components/ui/section-card";

describe("SectionCard", () => {
  it("renders the title as a heading and names the section with it", () => {
    render(
      <SectionCard title="Pembayaran" description="Ringkasan" action={<button>Ubah</button>} footer={<span>Catatan kaki</span>}>
        <p>Isi</p>
      </SectionCard>
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Pembayaran" });
    expect(heading).toHaveClass("text-h2");
    const region = screen.getByRole("region", { name: "Pembayaran" });
    expect(region.tagName).toBe("SECTION");
    expect(region).toHaveAccessibleDescription("Ringkasan");
    expect(screen.getByText("Ringkasan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ubah" })).toBeInTheDocument();
    expect(screen.getByText("Catatan kaki")).toBeInTheDocument();
    expect(screen.getByText("Isi")).toBeInTheDocument();
  });

  it("renders no header without a title", () => {
    const { container } = render(
      <SectionCard action={<button>Ubah</button>} description="Tidak tampil">
        <p>Isi</p>
      </SectionCard>
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-slot='section-card-header']")).toBeNull();
    expect(screen.getByText("Isi")).toBeInTheDocument();
  });

  it("keeps a caller aria-label and supports as=div and className", () => {
    const { container } = render(
      <SectionCard as="div" aria-label="Catatan" className="md:col-span-2" contentClassName="space-y-3">
        <p>Isi</p>
      </SectionCard>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root).toHaveAttribute("aria-label", "Catatan");
    expect(root).toHaveClass("md:col-span-2", "rounded-xl", "bg-card");
    expect(container.querySelector("[data-slot='section-card-content']")).toHaveClass("space-y-3");
  });
});
