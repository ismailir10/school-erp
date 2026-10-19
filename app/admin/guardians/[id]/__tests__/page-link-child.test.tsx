/**
 * "Tautkan anak" on the wali page: three entry points (section action, empty
 * state, attention-strip item), all gated by canEdit, and the page refetches
 * after a link.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GuardianDetailPage from "../page";
import { CLEAN_SUMMARY, fulfilledParams, makeParent, okJson } from "./parent-fixture";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const NO_CHILD = {
  hasKtp: true,
  hasKk: true,
  guardians: [],
  invoices: [],
  unpaidInvoices: [],
  invoiceSummary: CLEAN_SUMMARY,
};

async function renderWith(parent: Record<string, unknown>, extra?: (url: string, init?: RequestInit) => Promise<Response> | undefined) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return extra?.(url, init) ?? okJson(parent);
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
  await screen.findByRole("heading", { level: 1 });
  return { user, fetchMock };
}

const linkButtons = () => screen.queryAllByRole("button", { name: "Tautkan anak" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guardian page — Tautkan anak", () => {
  it("offers it from the section header, the empty state and the attention strip when no child is linked", async () => {
    const { user } = await renderWith(makeParent(NO_CHILD));

    expect(linkButtons()).toHaveLength(3);
    const strip = screen.getByRole("region", { name: "Perlu perhatian" });
    await user.click(within(strip).getByRole("button", { name: "Tautkan anak" }));

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Tautkan anak");
  });

  it("offers it from the section header when a child is already linked", async () => {
    const { user } = await renderWith(makeParent());
    const children = document.getElementById("children")!;
    await user.click(within(children).getByRole("button", { name: "Tautkan anak" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("is hidden entirely for a viewer who cannot edit", async () => {
    await renderWith(makeParent({ ...NO_CHILD, canEdit: false }));
    expect(linkButtons()).toHaveLength(0);
    // The strip still tells them the fact, without an action.
    expect(within(screen.getByRole("region", { name: "Perlu perhatian" })).getByText("Belum tertaut ke siswa")).toBeInTheDocument();
  });

  it("links a student and refetches the page", async () => {
    let linked = false;
    const { user, fetchMock } = await renderWith(makeParent(NO_CHILD), (url, init) => {
      if (url.startsWith("/api/students?")) {
        return okJson({ data: [{ id: "stu-9", name: "Zahra Putri", nickname: null, nis: null }], pagination: { total: 1 } });
      }
      if (url === "/api/students/stu-9/guardians" && init?.method === "POST") {
        linked = true;
        return okJson({ id: "sg-9" }, 201);
      }
      if (url === "/api/parents/p1" && linked) {
        return okJson(
          makeParent({
            ...NO_CHILD,
            guardians: [
              { id: "sg-9", relationship: "WALI", isPrimary: true, status: "ACTIVE", outstanding: 0, student: { id: "stu-9", name: "Zahra Putri", status: "ACTIVE", gender: "P", className: "KB B" } },
            ],
          }),
        );
      }
      return undefined;
    });

    // Section action first, empty-state button second.
    await user.click(within(document.getElementById("children")!).getAllByRole("button", { name: "Tautkan anak" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("combobox")[0]!);
    await user.type(await screen.findByPlaceholderText("Cari nama siswa..."), "Zahra");
    await user.click(await screen.findByRole("option", { name: /Zahra Putri/ }));
    await user.click(within(dialog).getByRole("button", { name: "Tautkan anak" }));

    expect(await screen.findByRole("link", { name: /Zahra Putri/ })).toHaveAttribute("href", "/admin/students/stu-9");
    expect(screen.queryByRole("region", { name: "Perlu perhatian" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/api/parents/p1")).toHaveLength(2);
  });
});
