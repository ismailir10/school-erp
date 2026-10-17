/**
 * Admin UI audit fixes (T8, finding #11) — the edit (Pencil) and reactivate
 * (RotateCcw) controls on each IKTP row were icon-only `<Button>`s with no
 * text and no `aria-label`, so a screen reader announced only "button" for
 * every row on the page. `getByRole("button", { name })` only resolves
 * through a real accessible name (aria-label, aria-labelledby, or text
 * content) — against the pre-fix markup these queries would throw
 * `Unable to find an accessible element with the role "button" and name`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import {
  IndicatorRow,
  ObjectiveEditDialog,
  AddIndicatorDialog,
  IndicatorEditDialog,
} from "../client";

const activeIndicator = {
  id: "ind-1",
  objectiveId: "obj-1",
  content: "Anak mampu menyebutkan angka 1-10",
  order: 3,
  status: "ACTIVE",
};

const inactiveIndicator = {
  ...activeIndicator,
  id: "ind-2",
  order: 5,
  status: "INACTIVE",
};

describe("IndicatorRow — icon-only button accessible names (AC11)", () => {
  it("names the edit control after the specific IKTP it acts on", () => {
    render(
      <IndicatorRow
        indicator={activeIndicator}
        themes={[]}
        canWrite
        currentLinks={[]}
        onChanged={vi.fn()}
        onLinkToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Ubah IKTP #3" }),
    ).toBeInTheDocument();
  });

  it("names the reactivate control after the specific inactive IKTP it acts on", () => {
    render(
      <IndicatorRow
        indicator={inactiveIndicator}
        themes={[]}
        canWrite
        currentLinks={[]}
        onChanged={vi.fn()}
        onLinkToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Aktifkan IKTP #5" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ubah IKTP #5" }),
    ).toBeInTheDocument();
  });
});

/**
 * T6 (2026-09-27 admin-finish-standard) — the three objectives-page dialogs
 * migrated from hand-rolled `useState` + inline "Gagal ..." toasts onto
 * react-hook-form + zod (`objectiveEditFormSchema`, `indicatorAddFormSchema`,
 * `indicatorEditFormSchema`, lib/validations/curriculum.ts). Each pair of
 * tests below pins (a) an empty required field blocks submit with an inline
 * error and fires no request, and (b) a valid submit sends the exact PUT/POST
 * body the route's own schema (`objectiveUpdateSchema` /
 * `indicatorAdminCreateSchema` / `indicatorUpdateSchema`) accepts.
 */

const objective = {
  id: "obj-1",
  semesterId: "sem-1",
  ageGroup: "A" as const,
  element: "STEAM" as const,
  number: 2,
  competencyText: "Anak mengenal konsep sains sederhana",
  content: "Anak dapat mengamati perubahan benda di sekitarnya",
  status: "ACTIVE",
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

describe("ObjectiveEditDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("blocks an empty submit with inline errors and sends no PUT", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <ObjectiveEditDialog open onOpenChange={vi.fn()} objective={objective} onSaved={vi.fn()} />,
    );

    await user.clear(screen.getByRole("textbox", { name: "Capaian Perkembangan Diri" }));
    await user.clear(screen.getByRole("textbox", { name: "Tujuan Pembelajaran" }));
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Capaian perkembangan diri wajib diisi")).toBeInTheDocument();
    expect(await screen.findByText("Tujuan pembelajaran wajib diisi")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the edited fields as a PUT body, trimmed", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(jsonResponse({ id: "obj-1" }) as Response));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <ObjectiveEditDialog open onOpenChange={vi.fn()} objective={objective} onSaved={onSaved} />,
    );

    const competencyField = screen.getByRole("textbox", { name: "Capaian Perkembangan Diri" });
    await user.clear(competencyField);
    await user.type(competencyField, "  Anak mengenal konsep sains lanjutan  ");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/curriculum/objectives/obj-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      competencyText: "Anak mengenal konsep sains lanjutan",
      content: objective.content,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("TP tersimpan"));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("AddIndicatorDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("blocks an empty Isi Indikator with an inline error and sends no POST", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <AddIndicatorDialog open onOpenChange={vi.fn()} objectiveId="obj-1" existingMax={2} onSaved={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Indikator (IKTP) wajib diisi")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a cleared Urutan with 'wajib diisi', not a silent fallback to 1", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <AddIndicatorDialog open onOpenChange={vi.fn()} objectiveId="obj-1" existingMax={2} onSaved={vi.fn()} />,
    );

    await user.type(screen.getByRole("textbox", { name: "Isi Indikator" }), "Anak mampu berhitung 1-10");
    await user.clear(screen.getByRole("spinbutton", { name: "Urutan" }));
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Urutan wajib diisi")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts objectiveId + content + a coerced order on a valid submit", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(jsonResponse({ id: "ind-9" }, true, 201) as Response));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <AddIndicatorDialog open onOpenChange={vi.fn()} objectiveId="obj-1" existingMax={2} onSaved={onSaved} />,
    );

    await user.type(screen.getByRole("textbox", { name: "Isi Indikator" }), "Anak mampu berhitung 1-10");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/curriculum/indicators");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      objectiveId: "obj-1",
      content: "Anak mampu berhitung 1-10",
      order: 3, // existingMax (2) + 1, the dialog's own default
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("IKTP ditambahkan"));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("IndicatorEditDialog", () => {
  const indicator = { id: "ind-1", objectiveId: "obj-1", content: "Anak mampu menyebutkan angka 1-10", order: 3, status: "ACTIVE" };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("blocks an empty submit with inline errors and sends no PUT", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(
      <IndicatorEditDialog open onOpenChange={vi.fn()} indicator={indicator} onSaved={vi.fn()} />,
    );

    await user.clear(screen.getByRole("textbox", { name: "Isi indikator" }));
    await user.clear(screen.getByRole("spinbutton", { name: "Urutan" }));
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Indikator (IKTP) wajib diisi")).toBeInTheDocument();
    expect(await screen.findByText("Urutan wajib diisi")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits content + order as a PUT body on a valid edit", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(jsonResponse({ id: "ind-1" }) as Response));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <IndicatorEditDialog open onOpenChange={vi.fn()} indicator={indicator} onSaved={onSaved} />,
    );

    // Let the dialog's initial autofocus settle before editing another field.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Isi indikator" })).toHaveFocus());
    const orderField = screen.getByRole("spinbutton", { name: "Urutan" });
    await user.clear(orderField);
    await user.type(orderField, "7");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/curriculum/indicators/ind-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      content: indicator.content,
      order: 7,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("IKTP tersimpan"));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
