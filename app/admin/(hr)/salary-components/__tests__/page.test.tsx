vi.mock("@/hooks/use-permission", () => ({ usePermissions: () => () => true, usePermission: () => true }));
/**
 * T6 — Komponen Gaji create/edit dialog migrated onto useZodForm + FormField
 * + applyServerErrors (same pattern as the holidays worked example).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import SalaryComponentsPage from "../page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Desktop Dialog branch — deterministic regardless of the coarse-pointer
// mock (there's no DatePicker on this page, but keeps parity with the other
// HR suites).
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

// Base UI `Select` fights userEvent's open/close/positioning internals for
// no test value here (same precedent as
// app/admin/classes/[id]/__tests__/client.test.tsx) — swap in plain,
// always-rendered elements so these tests drive the real form state.
vi.mock("@/components/ui/select", () => {
  const SelectCtx = React.createContext<{ onValueChange?: (v: string) => void }>({});

  function Select({
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: React.ReactNode;
  }) {
    return <SelectCtx.Provider value={{ onValueChange }}>{children}</SelectCtx.Provider>;
  }
  function SelectTrigger({ children, ...props }: React.ComponentProps<"button">) {
    return (
      <button type="button" {...props}>
        {children}
      </button>
    );
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    return <span>{placeholder ?? null}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const ctx = React.useContext(SelectCtx);
    return (
      <div role="option" aria-selected={false} onClick={() => ctx.onValueChange?.(value)}>
        {children}
      </div>
    );
  }
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import { toast } from "sonner";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

function fixture(overrides: { list?: unknown[]; post?: unknown; postOk?: boolean } = {}) {
  const { list = [], post = { id: "sc-1" }, postOk = true } = overrides;
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/salary-components" && (!init || init.method === undefined)) {
      return Promise.resolve(jsonResponse(list));
    }
    if (input === "/api/salary-components" && init?.method === "POST") {
      return Promise.resolve(jsonResponse(post, postOk, postOk ? 201 : 400));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SalaryComponentsPage — Tambah Komponen dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("blocks submit with empty required fields, showing inline errors and firing no POST", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<SalaryComponentsPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Komponen" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Komponen" });

    await user.click(within(dialog).getByRole("button", { name: "Tambah Komponen" }));

    expect(await within(dialog).findByText("Kode wajib diisi")).toBeInTheDocument();
    expect(within(dialog).getByText("Label wajib diisi")).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  it("submits the filled form as POST /api/salary-components with the expected body", async () => {
    const fetchMock = fixture({ post: { id: "sc-1" } });
    const user = userEvent.setup();
    render(<SalaryComponentsPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Komponen" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Komponen" });

    await user.type(within(dialog).getByRole("textbox", { name: "Kode" }), "tunjangan_baru");
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "Tunjangan Baru");

    await user.click(within(dialog).getByRole("button", { name: "Tambah Komponen" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/salary-components" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });

    const [, postInit] = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/salary-components" && (init as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      code: "tunjangan_baru",
      label: "Tunjangan Baru",
      category: "INCOME",
      calcType: "FIXED",
      isProRated: false,
      sortOrder: 1,
    });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Komponen ditambahkan"));
  });

  it("shows a server field error under Label on a 400 response, without closing the dialog", async () => {
    fixture({
      postOk: false,
      post: { error: "Validasi gagal", errors: [{ field: "label", message: "Label sudah dipakai" }] },
    });
    const user = userEvent.setup();
    render(<SalaryComponentsPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Komponen" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Komponen" });

    await user.type(within(dialog).getByRole("textbox", { name: "Kode" }), "tunjangan_baru");
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "Tunjangan Baru");

    await user.click(within(dialog).getByRole("button", { name: "Tambah Komponen" }));

    expect(await within(dialog).findByText("Label sudah dipakai")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Tambah Komponen" })).toBeInTheDocument();
  });

  it("F-15: shows the server's gaji_pokok ordering error inline under Urutan, without closing the dialog", async () => {
    fixture({
      postOk: false,
      post: {
        error: "Validasi gagal",
        errors: [{
          field: "sortOrder",
          message: "Komponen % Gaji Pokok harus diurutkan setelah Gaji Pokok (urutan > 3)",
        }],
      },
    });
    const user = userEvent.setup();
    render(<SalaryComponentsPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Komponen" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Komponen" });

    await user.type(within(dialog).getByRole("textbox", { name: "Kode" }), "insentif_persen");
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "Insentif Persen");

    await user.click(within(dialog).getByRole("button", { name: "Tambah Komponen" }));

    expect(
      await within(dialog).findByText(
        "Komponen % Gaji Pokok harus diurutkan setelah Gaji Pokok (urutan > 3)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Tambah Komponen" })).toBeInTheDocument();
  });
});

describe("SalaryComponentsPage — Edit Komponen dialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const component = {
    id: "sc-1",
    code: "tunjangan_transport",
    label: "Tunjangan Transport",
    category: "INCOME",
    calcType: "FIXED",
    isProRated: false,
    isEnabled: true,
    sortOrder: 2,
  };

  it("hides the Kode field (immutable) and sends PUT with the edited label", async () => {
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === "/api/salary-components" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse([component]));
      }
      if (input === `/api/salary-components/${component.id}` && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ ...component, label: "Transport Diperbarui" }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SalaryComponentsPage />);

    await user.click(await screen.findByRole("button", { name: /Buka menu aksi|Aksi untuk/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Komponen" });

    expect(within(dialog).queryByRole("textbox", { name: "Kode" })).not.toBeInTheDocument();

    const labelInput = within(dialog).getByRole("textbox", { name: "Label" });
    fireEvent.change(labelInput, { target: { value: "Transport Diperbarui" } });

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === `/api/salary-components/${component.id}` && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
    });

    const [, putInit] = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === `/api/salary-components/${component.id}` && (init as RequestInit | undefined)?.method === "PUT",
    )!;
    const body = JSON.parse((putInit as RequestInit).body as string);
    expect(body.label).toBe("Transport Diperbarui");
    expect(body.code).toBe("tunjangan_transport");

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Komponen diperbarui"));
  });

  it("still edits a seeded PCT_OF_BASE component (the create-only enum must not block it)", async () => {
    const pct = { ...component, id: "sc-2", code: "tunj_pct", label: "Tunjangan Persen", calcType: "PCT_OF_BASE" };
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === "/api/salary-components" && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse([pct]));
      }
      return Promise.resolve(jsonResponse(pct));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SalaryComponentsPage />);

    await user.click(await screen.findByRole("button", { name: /Buka menu aksi|Aksi untuk/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Komponen" });
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => url === `/api/salary-components/${pct.id}` && (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
      expect(JSON.parse((putCall![1] as RequestInit).body as string).calcType).toBe("PCT_OF_BASE");
    });
  });
});


describe("list load recovery", () => {
  it("shows a persistent read error and recovers with an explicit retry", async () => {
    let failed = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.startsWith("/api/salary-components")) return failed
        ? { ok: false, json: async () => ({ error: "Gagal memuat" }) }
        : { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ total: 0, draft: 0, approved: 0, slipsSent: 0 }) };
    }));
    render(<SalaryComponentsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Data belum bisa dimuat.");
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
