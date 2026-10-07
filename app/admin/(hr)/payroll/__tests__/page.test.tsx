import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <><h1>{title}</h1>{actions}</>
  ),
}));
vi.mock("@/components/ui/data-table", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui/data-table")>(
    "@/components/ui/data-table",
  );
  return actual;
});
vi.mock("@/components/ui/data-table-toolbar", () => ({ DataTableToolbar: () => null }));
vi.mock("@/components/admin/stats-cards-row", () => ({ StatsCardsRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/admin/stat-card", () => ({ StatCard: ({ label, value }: { label: string; value: string | number }) => <p>{label}: {value}</p> }));

import { toast } from "sonner";
import PayrollListPage from "../page";

function mockCoarsePointer() {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("coarse"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("payroll summary states", () => {
  it("shows unavailable on failed stats and recovers after retry", async () => {
    let statsRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/payroll/stats") {
        statsRequests++;
        return statsRequests === 1
          ? { ok: false }
          : { ok: true, json: async () => ({ total: 0, draft: 0, approved: 0, slipsSent: 0 }) };
      }
      return { ok: true, json: async () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) };
    }));

    render(<PayrollListPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ringkasan penggajian tidak bisa dimuat."));
    expect(screen.getByText("Total Penggajian: —")).toBeInTheDocument();
    expect(screen.queryByText("Total Penggajian: 0")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.getByText("Total Penggajian: 0")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("makes the period the link into the run detail page, with no separate Lihat action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "/api/payroll/stats") {
          return { ok: true, json: async () => ({ total: 1, draft: 1, approved: 0, slipsSent: 0 }) };
        }
        if (input.startsWith("/api/payroll?")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  id: "run-1",
                  periodStart: "2026-08-21",
                  periodEnd: "2026-09-20",
                  actualWorkDays: 22,
                  status: "DRAFT",
                  approvedAt: null,
                  _count: { items: 5 },
                },
              ],
              pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) };
      }),
    );

    render(<PayrollListPage />);

    const link = await screen.findByRole("link", { name: /2026-08-21/ });
    expect(link).toHaveAttribute("href", "/admin/payroll/run-1");
    expect(screen.queryByRole("button", { name: /Lihat/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Lihat")).not.toBeInTheDocument();
  });
});

describe("PayrollListPage — Buat Penggajian Baru dialog", () => {
  function fixture(overrides: { post?: unknown; postStatus?: number } = {}) {
    const { post = { id: "run-9" }, postStatus = 201 } = overrides;
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/payroll/stats") {
        return { ok: true, json: async () => ({ total: 0, draft: 0, approved: 0, slipsSent: 0 }) };
      }
      if (input === "/api/payroll/generate" && init?.method === "POST") {
        return { ok: postStatus >= 200 && postStatus < 300, status: postStatus, json: async () => post };
      }
      return { ok: true, json: async () => ({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("blocks submit with an empty period, showing inline errors and firing no POST", async () => {
    mockCoarsePointer();
    const fetchMock = fixture();
    render(<PayrollListPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Buat Penggajian" }));
    const dialog = await screen.findByRole("dialog", { name: "Buat Penggajian Baru" });

    // Clear the pre-filled default period so the required-string check fires.
    fireEvent.change(within(dialog).getByLabelText("Tanggal Mulai", { exact: false }), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Tanggal Selesai", { exact: false }), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Buat Draf Penggajian" }));

    expect((await within(dialog).findAllByText("Format tanggal harus YYYY-MM-DD")).length).toBeGreaterThan(0);

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url === "/api/payroll/generate" && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("submits the default period as POST /api/payroll/generate and closes the dialog", async () => {
    mockCoarsePointer();
    const fetchMock = fixture({ post: { id: "run-9" } });
    render(<PayrollListPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Buat Penggajian" }));
    const dialog = await screen.findByRole("dialog", { name: "Buat Penggajian Baru" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Buat Draf Penggajian" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/payroll/generate" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });
    const [, postInit] = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/payroll/generate" && (init as RequestInit | undefined)?.method === "POST",
    )!;
    const body = JSON.parse((postInit as RequestInit).body as string);
    expect(typeof body.periodStart).toBe("string");
    expect(typeof body.periodEnd).toBe("string");

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Draf penggajian dibuat"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the 422 missing-rekening list on screen as an inline alert with a link per employee (HR-3)", async () => {
    mockCoarsePointer();
    fixture({
      postStatus: 422,
      post: {
        error: "Beberapa karyawan belum memiliki No. Rekening lengkap",
        employees: [{ id: "e1", kode: "K-01", nama: "Budi", reason: "rekening missing" }],
      },
    });
    render(<PayrollListPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Buat Penggajian" }));
    const dialog = await screen.findByRole("dialog", { name: "Buat Penggajian Baru" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Buat Draf Penggajian" }));

    const alert = await within(dialog).findByTestId("payroll-generate-blockers");
    expect(alert).toHaveTextContent("Beberapa karyawan belum memiliki No. Rekening lengkap");
    expect(within(alert).getByRole("link", { name: "Lengkapi rekening" })).toHaveAttribute("href", "/admin/employees/e1#profile");
    // Not a vanishing toast, and the dialog stays open for retry.
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Buat Penggajian Baru" })).toBeInTheDocument();
  });
});
