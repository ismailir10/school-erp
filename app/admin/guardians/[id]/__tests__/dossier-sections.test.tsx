/**
 * The wali (guardian) detail page is a Recipe 2b Dossier: one scroll,
 * `DossierNav` + `DossierSection[]`, mirroring `app/admin/students/[id]`.
 *
 * Pins the contracts a layout change must not lose: every section is a real
 * DOM anchor (`#profile`, `#documents`, `#children`, `#invoices`) an admin can
 * deep-link to, each is also a disclosure trigger and a nav button, the order
 * is answer-first, and a closed section still says what is inside it.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GuardianDetailPage from "../page";
import { fulfilledParams, makeParent, stubFetchWith } from "./parent-fixture";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Answer-first order: children, invoices, then the wali's own data and files.
const SECTIONS = [
  { id: "children", label: "Anak Terdaftar" },
  { id: "invoices", label: "Tagihan" },
  { id: "profile", label: "Data Wali" },
  { id: "documents", label: "Dokumen" },
];

async function renderPage() {
  stubFetchWith(makeParent());
  const user = userEvent.setup();
  render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Ibu Siti Aminah" })).toBeInTheDocument(),
  );
  return user;
}

describe("guardian dossier — section anchors", () => {
  it("renders every section as a hash-addressable DossierSection, in answer-first order", async () => {
    await renderPage();

    for (const { id, label } of SECTIONS) {
      const section = document.getElementById(id);
      expect(section, `#${id} should exist as a DOM anchor`).not.toBeNull();
      expect(
        section!.querySelector('[data-slot="collapsible-trigger"]'),
        `#${id} should have a disclosure trigger`,
      ).not.toBeNull();
      expect(section!.textContent).toContain(label);
    }

    // DOM order of the anchors matches the nav order below.
    const domOrder = SECTIONS.map(({ id }) => document.getElementById(id)!);
    for (let i = 1; i < domOrder.length; i++) {
      expect(
        domOrder[i - 1].compareDocumentPosition(domOrder[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${SECTIONS[i - 1].id} should come before ${SECTIONS[i].id}`,
      ).toBeTruthy();
    }

    const nav = screen.getByRole("navigation", { name: "Bagian halaman" });
    const navLabels = Array.from(nav.querySelectorAll("button")).map((b) => b.textContent);
    expect(navLabels).toEqual(SECTIONS.map((s) => s.label));
  });

  it("opens children, invoices and profile by default and keeps Dokumen collapsed with its summary", async () => {
    const user = await renderPage();

    // Content of the three open sections is visible without a click.
    expect(screen.getByText("Ahmad Fajar")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("siti@example.test")).toBeInTheDocument();

    // Dokumen is closed: no upload control, and the header carries the summary.
    const documents = document.getElementById("documents")!;
    expect(screen.queryByText(/Unggah KTP|Ganti KTP/)).not.toBeInTheDocument();
    expect(within(documents).getByText("KTP ada · KK belum ada")).toBeInTheDocument();

    // Expanding via its trigger shows the content and hides the summary.
    await user.click(documents.querySelector('[data-slot="collapsible-trigger"]') as HTMLElement);
    expect(await screen.findByText(/Ganti KTP/)).toBeInTheDocument();
    expect(within(documents).queryByText("KTP ada · KK belum ada")).not.toBeInTheDocument();
  });

  it("expands a collapsed section from the nav before scrolling to it", async () => {
    const user = await renderPage();
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    const nav = screen.getByRole("navigation", { name: "Bagian halaman" });
    await user.click(within(nav).getByRole("button", { name: "Dokumen" }));

    expect(await screen.findByText(/Ganti KTP/)).toBeInTheDocument();
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });
});
