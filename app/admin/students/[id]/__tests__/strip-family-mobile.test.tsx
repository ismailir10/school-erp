/**
 * Phone: the strip and the family row are in the first screen, the contact
 * buttons are present, and no stat-tile block sits above the sections. The rail
 * stays in the DOM but is `hidden` below `lg`. `useIsMobile` is mocked rather
 * than the window resized (see groups-mobile.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

import StudentDetailPage from "@/app/admin/students/[id]/page";
import { INVOICES_OWED, ResizeObserverStub, stubFetch } from "./student-fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

describe("student page — phone first screen", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("shows the strip and the family contact before the first group", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: INVOICES_OWED }).fn);
    render(<StudentDetailPage />);
    const strip = await screen.findByRole("region", { name: "Perlu perhatian" });
    const family = screen.getByRole("region", { name: "Kontak keluarga" });
    const firstGroup = document.getElementById("group-profil")!;

    expect(strip.compareDocumentPosition(family) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(family.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(family).getByRole("link", { name: "WhatsApp" })).toBeInTheDocument();
    expect(within(family).getByRole("link", { name: "Telepon" })).toBeInTheDocument();
    // 44px: the jump button carries the touch floor; Buttons get it on coarse pointers.
    expect(within(family).getByRole("button", { name: "2 wali · Lihat semua" }).className).toContain("tap-target");
  });

  it("puts no tile block above the sections: the numbers live only in the hidden rail", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: INVOICES_OWED }).fn);
    render(<StudentDetailPage />);
    await screen.findByRole("region", { name: "Kontak keluarga" });

    const tunggakan = screen.getAllByText("Tunggakan");
    expect(tunggakan).toHaveLength(1);
    const rail = tunggakan[0].closest("aside")!;
    expect(rail.className).toContain("hidden");
    // And no other Ringkasan / Berkas cards after the sections.
    expect(screen.queryByText("Kelengkapan Berkas", { selector: "h3" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ringkasan", { selector: "h3" })).not.toBeInTheDocument();
  });
});
