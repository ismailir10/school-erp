/**
 * T6 — Pengajuan Cuti review dialog migrated onto useZodForm + FormField +
 * applyServerErrors. The reason Textarea is shared by approve/reject; only
 * reject requires it (leaveReviewFormSchema's superRefine).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import AdminLeavePage from "../page";

const pending = {
  id: "lr-1",
  leaveType: "ANNUAL",
  startDate: "2026-10-01",
  endDate: "2026-10-02",
  days: 2,
  reason: "Acara keluarga",
  status: "PENDING",
  reviewNote: null,
  createdAt: "2026-09-20",
  employee: { nama: "Budi Santoso", kode: "E-001", jabatan: "Guru Kelas", campus: { name: "Kampus Utama" } },
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

/**
 * Opens the row's "⋮" (Aksi untuk ...) dropdown and clicks the named
 * `extraActions` menu item. `fireEvent.click` (not `userEvent.click`) —
 * base-ui's Menu occasionally doesn't register the very first trigger
 * click under CPU contention (portal + floating-ui positioning settling).
 * Polls on a plain `setTimeout` (not a MutationObserver-driven `waitFor`,
 * which re-fires mid-open-transition and can re-click the trigger while
 * it's still animating open, toggling it shut) and only re-clicks the
 * trigger while no menu is open yet, so an already-open one is never
 * toggled closed. The budget (60 × 100ms = 6s) is a loop count, not a
 * per-call timeout override — it stays comfortably under the project's
 * 30s testTimeout even under flake-hunt-style oversubscription.
 */
async function clickRowMenuItem(trigger: HTMLElement, itemName: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!screen.queryByRole("menu")) fireEvent.click(trigger);
    const item = screen.queryByRole("menuitem", { name: itemName });
    if (item) {
      fireEvent.click(item);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`clickRowMenuItem: menuitem "${itemName}" never appeared`);
}

function fixture(overrides: { post?: unknown; postOk?: boolean } = {}) {
  const { post = { id: "lr-1", status: "REJECTED" }, postOk = true } = overrides;
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input.startsWith("/api/leave/stats")) {
      return Promise.resolve(jsonResponse({ total: 1, pending: 1, approved: 0, rejected: 0 }));
    }
    if (input.startsWith("/api/leave/requests/") && init?.method === "POST") {
      return Promise.resolve(jsonResponse(post, postOk, postOk ? 200 : 400));
    }
    if (input.startsWith("/api/leave/requests?")) {
      return Promise.resolve(
        jsonResponse({
          data: [pending],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          capabilities: { approve: true },
        }),
      );
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AdminLeavePage — review dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("blocks Tolak submit with an empty reason, showing an inline error and firing no POST", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<AdminLeavePage />);

    // Wait for both mount-time fetches (stats + the list) to settle before
    // opening the row menu — the page's `columns` array (unmemoized,
    // pre-existing) is rebuilt on every render, so a state update racing
    // the click (e.g. the stats fetch resolving) would remount the row's
    // cells and snap the just-opened dropdown shut (see ui.md's DataTable
    // "mobile contract" note on unmemoized columns).
    await screen.findByText("Menunggu");
    const trigger = await screen.findByRole("button", { name: "Aksi untuk Budi Santoso" });

    await clickRowMenuItem(trigger, "Tolak");

    const dialog = await screen.findByRole("dialog", { name: "Tolak Cuti" });
    await user.click(within(dialog).getByRole("button", { name: "Tolak" }));

    expect(await within(dialog).findByText("Alasan penolakan wajib diisi")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => (url as string).includes("/reject") && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("shows the min-length message inline when the rejection reason is too short", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<AdminLeavePage />);

    await screen.findByText("Menunggu");
    const trigger = await screen.findByRole("button", { name: "Aksi untuk Budi Santoso" });
    await clickRowMenuItem(trigger, "Tolak");

    const dialog = await screen.findByRole("dialog", { name: "Tolak Cuti" });
    await user.type(within(dialog).getByRole("textbox", { name: "Alasan Penolakan" }), "abc");
    await user.click(within(dialog).getByRole("button", { name: "Tolak" }));

    expect(await within(dialog).findByText("Alasan penolakan minimal 5 karakter")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => (url as string).includes("/reject") && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("submits Tolak as POST .../reject with the typed reason", async () => {
    const fetchMock = fixture({ post: { id: "lr-1", status: "REJECTED" } });
    const user = userEvent.setup();
    render(<AdminLeavePage />);

    await screen.findByText("Menunggu");
    const trigger = await screen.findByRole("button", { name: "Aksi untuk Budi Santoso" });

    await clickRowMenuItem(trigger, "Tolak");

    const dialog = await screen.findByRole("dialog", { name: "Tolak Cuti" });
    await user.type(within(dialog).getByRole("textbox", { name: "Alasan Penolakan" }), "Tidak memenuhi syarat");
    await user.click(within(dialog).getByRole("button", { name: "Tolak" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === "/api/leave/requests/lr-1/reject" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });

    const [, postInit] = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/leave/requests/lr-1/reject" && (init as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({ note: "Tidak memenuhi syarat" });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cuti ditolak"));
  });

  it("submits Setujui as POST .../approve with an empty (optional) note", async () => {
    const fetchMock = fixture({ post: { id: "lr-1", status: "APPROVED" } });
    const user = userEvent.setup();
    render(<AdminLeavePage />);

    await screen.findByText("Menunggu");
    const trigger = await screen.findByRole("button", { name: "Aksi untuk Budi Santoso" });

    await clickRowMenuItem(trigger, "Setujui");

    const dialog = await screen.findByRole("dialog", { name: "Setujui Cuti" });
    // R2-ADMIN-13: no raw enum code in the helper copy.
    expect(within(dialog).getByText(/berstatus Izin/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/LEAVE/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Setujui" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === "/api/leave/requests/lr-1/approve" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });

    const [, postInit] = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/leave/requests/lr-1/approve" && (init as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({ note: "" });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cuti disetujui"));
  });
});
