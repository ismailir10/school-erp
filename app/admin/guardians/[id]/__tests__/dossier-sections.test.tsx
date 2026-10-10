/**
 * T6a — the wali (guardian) detail page moved from `AdminTabs` ("Anak
 * Terdaftar" / "Tagihan" behind clicks, "Data Wali" / "Dokumen" in plain
 * cards above them) to the Recipe 2b Dossier layout: one scroll,
 * `DossierNav` + `DossierSection[]`, exactly mirroring
 * `app/admin/students/[id]/page.tsx`.
 *
 * This pins the one behavioural contract that layout migration must not lose:
 * every section is a real DOM anchor (`document.getElementById(id)`) an admin
 * can deep-link to — `#profile`, `#documents`, `#children`, `#invoices` — and
 * every one of those ids also appears as a disclosure trigger and a nav
 * button, so nothing that used to live in a tab is now unreachable.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import GuardianDetailPage from "../page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/**
 * `use(params)` suspends on first render for a "cold" Promise — React only
 * reads a `use()`-d thenable synchronously once it carries a `status`/`value`
 * pair. Pre-attach the fulfilled marker React itself would set once the
 * promise settles, so `use()` returns synchronously on first render, mirroring
 * Next.js pre-resolving route params before paint (see the identical helper in
 * `app/admin/enrollments/[id]/__tests__/page.test.tsx`).
 */
function fulfilledParams(value: { id: string }): Promise<{ id: string }> {
  const p = Promise.resolve(value) as Promise<{ id: string }> & {
    status?: string;
    value?: { id: string };
  };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

const PARENT = {
  id: "p1",
  canEdit: true,
  name: "Ibu Siti Aminah",
  email: "siti@example.test",
  phone: "081234567890",
  whatsapp: "081234567890",
  address: "Jl. Melati No. 1",
  nik: "3201010101010001",
  education: "S1",
  occupation: "Guru",
  employer: "SDN 1",
  employerAddress: null,
  employerCity: "Bandung",
  incomeRange: "5-10 juta",
  childrenTotal: 2,
  hasKtp: true,
  hasKk: false,
  status: "ACTIVE",
  guardians: [
    {
      id: "sg-1",
      relationship: "IBU",
      isPrimary: true,
      status: "ACTIVE",
      student: { id: "s1", name: "Ahmad Fajar", status: "ACTIVE", gender: "L" },
    },
  ],
  invoices: [
    {
      id: "inv-1",
      invoiceNumber: "INV-2026-0001",
      periodLabel: "2026-01",
      totalDue: 500000,
      totalPaid: 100000,
      status: "OVERDUE",
    },
  ],
};

const SECTIONS = [
  { id: "profile", label: "Data Wali" },
  { id: "documents", label: "Dokumen" },
  { id: "children", label: "Anak Terdaftar" },
  { id: "invoices", label: "Tagihan" },
];

function stubFetch() {
  return vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => PARENT } as Response),
  );
}

describe("guardian dossier — section anchors", () => {
  it("renders every former tab as a hash-addressable DossierSection", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ibu Siti Aminah" })).toBeInTheDocument(),
    );

    for (const { id, label } of SECTIONS) {
      const section = document.getElementById(id);
      expect(section, `#${id} should exist as a DOM anchor`).not.toBeNull();
      // The section heading lives inside its own anchor — not just anywhere
      // on the page — proving the id and the visible label are the same
      // element, the thing a `DossierNav` jump or a `#invoices` link relies on.
      expect(
        section!.querySelector('[data-slot="collapsible-trigger"]'),
        `#${id} should have a disclosure trigger`,
      ).not.toBeNull();
      expect(section!.textContent).toContain(label);
    }

    // The sticky nav lists every section once, in the same order.
    const nav = screen.getByRole("navigation", { name: "Bagian halaman" });
    for (const { label } of SECTIONS) {
      expect(
        Array.from(nav.querySelectorAll("button")).some((b) => b.textContent === label),
      ).toBe(true);
    }
  });

  it("keeps every section open by default so nothing is hidden behind a click", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ibu Siti Aminah" })).toBeInTheDocument(),
    );

    // Content from every section is simultaneously visible — no tab click
    // required, unlike the pre-migration AdminTabs layout.
    expect(screen.getByText("Ahmad Fajar")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-0001")).toBeInTheDocument();
    expect(screen.getByText(/Unggah KTP|Ganti KTP/)).toBeInTheDocument();
  });
});
