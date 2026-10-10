/**
 * T2 (cycle 2026-09-25, Pendaftaran merge) — this page used to have its own
 * confusingly-named nav entry ("Formulir Pendaftaran"). It's now the
 * "Formulir" sub-view of the single "Pendaftaran" nav entry, sharing a
 * link-tab strip with /admin/admissions ("Calon Siswa").
 *
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the row action column (a
 * hand-rolled `<Button>Lihat</Button>`, then a `DataTableRowActions`
 * `onView`) is gone; the child's name cell is now the row's only link to
 * the detail page (`DataTableLinkCell`), and the row had no other action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import EnrollmentsPage from "@/app/admin/enrollments/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/enrollments",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const rows = [
  {
    id: "ea-1",
    childName: "Aisyah Putri",
    parentEmail: "ibu@example.com",
    status: "SUBMITTED",
    dcareAddon: false,
    submittedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    studentId: null,
    program: { name: "TK A" },
  },
];

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/enrollments?")) {
      const parsed = new URL(url, "http://localhost");
      const status = parsed.searchParams.get("status");
      const pageSize = parsed.searchParams.get("pageSize");
      // Stats calls: pageSize=1 with/without a status filter.
      if (pageSize === "1") {
        const total = !status ? rows.length : status === "SUBMITTED" ? 1 : 0;
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [], pagination: { page: 1, pageSize: 1, total, totalPages: total > 0 ? 1 : 0 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: rows,
          pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("EnrollmentsPage — Pendaftaran tab strip", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the Calon Siswa / Formulir strip with Formulir marked current", async () => {
    render(<EnrollmentsPage />);

    const formulir = await screen.findByRole("link", { name: "Formulir" });
    expect(formulir).toHaveAttribute("href", "/admin/enrollments");
    expect(formulir).toHaveAttribute("aria-current", "page");

    const calonSiswa = screen.getByRole("link", { name: "Calon Siswa" });
    expect(calonSiswa).toHaveAttribute("href", "/admin/admissions");
    expect(calonSiswa).not.toHaveAttribute("aria-current");
  });
});

describe("EnrollmentsPage — name is the link (T7)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the child's name as a link to the detail page and drops the separate Lihat button", async () => {
    render(<EnrollmentsPage />);

    const nameLink = await screen.findByRole("link", { name: "Aisyah Putri" });
    expect(nameLink).toHaveAttribute("href", "/admin/enrollments/ea-1");
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();
  });
});

describe("EnrollmentsPage — pendaftaran fee column", () => {
  const withFee = (id: string, name: string, fee: unknown, followUp: unknown) => ({
    ...rows[0],
    id,
    childName: name,
    fee,
    followUp,
  });
  const feeRows = [
    withFee("ea-1", "Aisyah Putri", { status: "UNPAID", amount: 240000 }, { canRemind: true }),
    withFee("ea-2", "Budi Santoso", { status: "UNPAID", amount: 300000 }, { canRemind: false }),
    withFee("ea-3", "Citra Lestari", { status: "PAID", amount: 300000 }, null),
    withFee("ea-4", "Dewi Anggraini", { status: "WAIVED", amount: 0 }, null),
    withFee("ea-5", "Eko Prasetyo", null, null),
  ];
  const calls: string[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);
        const parsed = new URL(url, "http://localhost");
        if (parsed.searchParams.get("pageSize") === "1") {
          const total = parsed.searchParams.get("payment") === "unpaid" ? 2 : 5;
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [], pagination: { page: 1, pageSize: 1, total, totalPages: 1 } }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: feeRows,
            pagination: { page: 1, pageSize: 20, total: feeRows.length, totalPages: 1 },
          }),
        } as Response);
      }),
    );
  });

  it("shows each row's fee status, with the amount owed", async () => {
    render(<EnrollmentsPage />);
    await screen.findByRole("link", { name: "Aisyah Putri" });

    expect(screen.getAllByText("Belum bayar").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Lunas")).toBeInTheDocument();
    expect(screen.getByText("Dibebaskan")).toBeInTheDocument();
    expect(screen.getByText("Tanpa biaya")).toBeInTheDocument();
    expect(screen.getByText(/240\.000/)).toBeInTheDocument();
  });

  it("an unpaid row with a number links to the reminder endpoint in a new tab (never a wa.me URL with a token)", async () => {
    render(<EnrollmentsPage />);
    await screen.findByRole("link", { name: "Aisyah Putri" });

    const wa = screen.getByRole("link", { name: "Ingatkan lewat WhatsApp: Aisyah Putri" });
    expect(wa).toHaveAttribute("href", "/api/enrollments/ea-1/fee/reminder");
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa.getAttribute("rel")).toContain("noopener");
    expect(document.body.innerHTML).not.toContain("wa.me");
  });

  it("an unpaid row without a number says so instead of offering a dead link", async () => {
    render(<EnrollmentsPage />);
    await screen.findByRole("link", { name: "Budi Santoso" });

    expect(screen.getByText("Belum ada nomor WhatsApp")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /WhatsApp: Budi Santoso/ })).not.toBeInTheDocument();
  });

  it("paid, waived and fee-less rows offer no reminder", async () => {
    render(<EnrollmentsPage />);
    await screen.findByRole("link", { name: "Citra Lestari" });
    expect(screen.getAllByRole("link", { name: /^Ingatkan lewat WhatsApp/ })).toHaveLength(1);
  });

  it("counts the unpaid ones in a stat card from the payment filter", async () => {
    render(<EnrollmentsPage />);
    await screen.findByRole("link", { name: "Aisyah Putri" });
    expect(calls.some((u) => u.includes("pageSize=1") && u.includes("payment=unpaid"))).toBe(true);
  });
});
