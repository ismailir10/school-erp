import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import UsersPage from "@/app/admin/settings/users/page";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
  },
}));

vi.mock("@/components/ui/data-table-row-actions", () => ({
  DataTableRowActions: ({
    onEdit,
    onDeactivate,
    onActivate,
  }: {
    onEdit?: () => void;
    onDeactivate?: () => void;
    onActivate?: () => void;
  }) => (
    <>
      {onEdit && (
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      )}
      {onDeactivate && (
        <button type="button" onClick={onDeactivate}>
          Nonaktifkan
        </button>
      )}
      {onActivate && (
        <button type="button" onClick={onActivate}>
          Aktifkan
        </button>
      )}
    </>
  ),
}));

/**
 * Routes `/api/auth/me` (who is signed in) to a fixed session so the
 * positional `mockResolvedValueOnce` chains below keep describing only the
 * roles / users / PUT traffic.
 */
function withSession(chain: (url: string, init?: unknown) => unknown, sessionId = "admin-0") {
  return vi.fn((url: string, init?: unknown) =>
    url === "/api/auth/me"
      ? Promise.resolve({ ok: true, json: async () => ({ id: sessionId }) })
      : chain(url, init),
  );
}

function usersListResponse(rows: Array<Record<string, unknown>>) {
  return {
    ok: true,
    json: async () => ({
      data: rows,
      pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
    }),
  };
}

describe("UsersPage deactivate/activate confirmation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not flip status until the deactivate confirm dialog is confirmed", async () => {
    const user = userEvent.setup();
    const activeUser = {
      id: "user-1",
      name: "Budi Santoso",
      email: "budi@example.com",
      role: "TEACHER",
      status: "ACTIVE",
      lastLoginAt: null,
      customRoleId: null,
      customRole: null,
    };
    const fetchMock = vi
      .fn()
      // roles fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      // initial list fetch
      .mockResolvedValueOnce(usersListResponse([activeUser]))
      // PUT status
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // refetch after success
      .mockResolvedValueOnce(usersListResponse([{ ...activeUser, status: "INACTIVE" }]));
    vi.stubGlobal("fetch", withSession(fetchMock));

    render(<UsersPage />);

    await screen.findByText("Budi Santoso");

    await user.click(screen.getByRole("button", { name: "Nonaktifkan" }));

    // The confirm dialog must appear — no PUT fired by the row click alone.
    await screen.findByText('Nonaktifkan "Budi Santoso"?');
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/users/user-1",
      expect.objectContaining({ method: "PUT" }),
    );

    const deactivateDialog = screen.getByRole("alertdialog");
    await user.click(within(deactivateDialog).getByRole("button", { name: "Nonaktifkan" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/users/user-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INACTIVE" }),
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Pengguna dinonaktifkan");
    });
  });

  it("does not flip status until the activate confirm dialog is confirmed", async () => {
    const user = userEvent.setup();
    const inactiveUser = {
      id: "user-2",
      name: "Sari Wulandari",
      email: "sari@example.com",
      role: "TEACHER",
      status: "INACTIVE",
      lastLoginAt: null,
      customRoleId: null,
      customRole: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce(usersListResponse([inactiveUser]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce(usersListResponse([{ ...inactiveUser, status: "ACTIVE" }]));
    vi.stubGlobal("fetch", withSession(fetchMock));

    render(<UsersPage />);

    await screen.findByText("Sari Wulandari");

    await user.click(screen.getByRole("button", { name: "Aktifkan" }));

    await screen.findByText('Aktifkan "Sari Wulandari"?');
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/users/user-2",
      expect.objectContaining({ method: "PUT" }),
    );

    const activateDialog = screen.getByRole("alertdialog");
    await user.click(within(activateDialog).getByRole("button", { name: "Aktifkan" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/users/user-2", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Pengguna diaktifkan");
    });
  });

  it("renders the user name as plain text with no Lihat action (no detail page)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce(
        usersListResponse([
          {
            id: "user-3",
            name: "Dewi Anggraini",
            email: "dewi@example.com",
            role: "TEACHER",
            status: "ACTIVE",
            lastLoginAt: null,
            customRoleId: null,
            customRole: null,
          },
        ]),
      );
    vi.stubGlobal("fetch", withSession(fetchMock));

    render(<UsersPage />);

    const name = await screen.findByText("Dewi Anggraini");
    expect(name.closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /Lihat/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Lihat")).not.toBeInTheDocument();
  });
});

describe("UsersPage edit dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("submits the PUT with the selected role mapped and the current status", async () => {
    const editUser = {
      id: "user-9",
      name: "Guru Baru",
      email: "guru@example.com",
      role: "TEACHER",
      status: "ACTIVE",
      lastLoginAt: null,
      customRoleId: null,
      customRole: null,
    };
    const role = { id: "role-1", name: "Wali Kelas", code: "WALI_KELAS" };
    const fetchMock = vi
      .fn()
      // roles fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [role] }) })
      // initial list fetch
      .mockResolvedValueOnce(usersListResponse([editUser]))
      // PUT
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // refetch after success
      .mockResolvedValueOnce(usersListResponse([{ ...editUser, customRoleId: role.id, customRole: role }]));
    vi.stubGlobal("fetch", withSession(fetchMock));
    const user = userEvent.setup();

    render(<UsersPage />);

    await screen.findByText("Guru Baru");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Pengguna" });
    await user.click(within(dialog).getByRole("combobox", { name: /Peran Kustom/ }));
    await user.click(await screen.findByRole("option", { name: "Wali Kelas" }));

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/users/user-9", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customRoleId: "role-1", status: "ACTIVE" }),
      });
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Pengguna diperbarui"));
  });
});

describe("UsersPage own row (ADM-16)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const base = { role: "SCHOOL_ADMIN", status: "ACTIVE", lastLoginAt: null, customRoleId: null, customRole: null };

  it("offers Nonaktifkan on other users but not on the signed-in user's own row", async () => {
    const me = { ...base, id: "admin-0", name: "Ibu Kepala", email: "kepala@example.com" };
    const other = { ...base, id: "user-5", name: "Pak Guru", email: "guru@example.com", role: "TEACHER" };
    const chain = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce(usersListResponse([me, other]));
    vi.stubGlobal("fetch", withSession(chain, "admin-0"));

    render(<UsersPage />);

    await screen.findByText("Pak Guru");
    // Own row loses the action once /api/auth/me resolves; the other stays.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Nonaktifkan" })).toHaveLength(1);
    });
    // Both rows keep Edit.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });
});
