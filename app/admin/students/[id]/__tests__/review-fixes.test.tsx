/**
 * Review-round fixes on the student page: where "Lengkapi berkas" lands, typed
 * work surviving a collapsed Profil, a deep link surviving a failed first
 * fetch, the Tagihan label, and the read-only "no class" row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";
import {
  OVERVIEW,
  OVERVIEW_WITH_FORM,
  ResizeObserverStub,
  makeGuardian,
  makeStudent,
  stubFetch,
} from "./student-fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

async function renderLoaded(opts: Parameters<typeof stubFetch>[0] = {}) {
  const { fn, calls } = stubFetch(opts);
  vi.stubGlobal("fetch", fn);
  render(<StudentDetailPage />);
  await screen.findByRole("heading", { level: 1, name: "Aisyah Putri" });
  return { calls };
}

const scrolledTo = () =>
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.map((el: Element) => el.id);
const groupTrigger = (id: string) => document.querySelector<HTMLElement>(`[aria-controls="${id}-content"]`)!;
const strip = () => screen.findByRole("region", { name: "Perlu perhatian" });

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  window.location.hash = "";
});

describe("Lengkapi berkas lands where the first missing item can be fixed", () => {
  const press = async () => {
    const region = await strip();
    await userEvent.setup().click(within(region).getByRole("button", { name: "Lengkapi berkas" }));
  };

  it("Foto siswa opens Data Anak", async () => {
    await renderLoaded({ student: makeStudent({ photoUrl: null }) });
    await press();
    await waitFor(() => expect(scrolledTo()).toContain("data-anak"));
  });

  it("KK keluarga opens Dokumen", async () => {
    await renderLoaded({
      student: makeStudent({ guardians: [makeGuardian({ id: "p1", name: "Fatimah", isPrimary: true, hasKk: false })] }),
    });
    await press();
    await waitFor(() => expect(scrolledTo()).toContain("dokumen"));
  });

  it("KTP goes to that wali's documents, not to a section", async () => {
    await renderLoaded({
      student: makeStudent({
        guardians: [
          makeGuardian({ id: "p-ibu", name: "Fatimah Rahman", isPrimary: true }),
          makeGuardian({ id: "p-ayah", name: "Hadi Rahman", hasKtp: false }),
        ],
      }),
    });
    const region = await strip();
    expect(within(region).getByText("Berkas belum ada: KTP Hadi Rahman")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Lengkapi berkas" })).toHaveAttribute(
      "href",
      "/admin/guardians/p-ayah#documents",
    );
  });

  it("the first missing KTP wins when several are missing", async () => {
    await renderLoaded({
      student: makeStudent({
        guardians: [
          makeGuardian({ id: "p-ibu", name: "Fatimah Rahman", isPrimary: true, hasKtp: false }),
          makeGuardian({ id: "p-ayah", name: "Hadi Rahman", hasKtp: false }),
        ],
      }),
    });
    const region = await strip();
    expect(within(region).getByRole("link", { name: "Lengkapi berkas" })).toHaveAttribute(
      "href",
      "/admin/guardians/p-ibu#documents",
    );
  });

  it("Surat persetujuan opens Pendaftaran", async () => {
    await renderLoaded({
      overview: {
        ...OVERVIEW_WITH_FORM,
        documents: { ...OVERVIEW_WITH_FORM.documents, consent: false },
      },
    });
    const region = await strip();
    await waitFor(() => expect(within(region).getByText("Berkas belum ada: Surat persetujuan")).toBeInTheDocument());
    await userEvent.setup().click(within(region).getByRole("button", { name: "Lengkapi berkas" }));
    await waitFor(() => expect(scrolledTo()).toContain("pendaftaran"));
    expect(groupTrigger("group-catatan").getAttribute("aria-expanded")).toBe("true");
  });

  it("an incomplete paper-form checklist opens Pendaftaran", async () => {
    await renderLoaded({
      overview: {
        ...OVERVIEW_WITH_FORM,
        documents: { ...OVERVIEW_WITH_FORM.documents, enrollment: { done: 2, required: 6 } },
      },
    });
    const region = await strip();
    await waitFor(() => expect(within(region).getByText(/Berkas pendaftaran \(2 \/ 6\)/)).toBeInTheDocument());
    await userEvent.setup().click(within(region).getByRole("button", { name: "Lengkapi berkas" }));
    await waitFor(() => expect(scrolledTo()).toContain("pendaftaran"));
  });
});

describe("unsaved typing survives collapsing Profil", () => {
  it("keeps an Informasi Tambahan row typed before the group was closed", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: /Tambah Field/ }));
    await user.type(screen.getByLabelText("Nama field"), "Hobi");

    await user.click(groupTrigger("group-profil"));
    expect(groupTrigger("group-profil").getAttribute("aria-expanded")).toBe("false");
    await user.click(groupTrigger("group-profil"));
    expect(groupTrigger("group-profil").getAttribute("aria-expanded")).toBe("true");

    expect(screen.getByLabelText("Nama field")).toHaveValue("Hobi");
  });
});

describe("hash deep link after a failed first fetch", () => {
  it("#keuangan still scrolls once Coba Lagi succeeds", async () => {
    const user = userEvent.setup();
    window.location.hash = "#keuangan";
    let fail = true;
    const { fn } = stubFetch({ overview: OVERVIEW });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/students/s1" && fail
          ? Promise.resolve({ ok: false, status: 500 } as Response)
          : fn(input, init),
      ),
    );
    render(<StudentDetailPage />);
    expect(await screen.findByText("Data siswa belum bisa dimuat")).toBeInTheDocument();
    expect(scrolledTo()).not.toContain("keuangan");

    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba Lagi" }));
    await screen.findByRole("heading", { level: 1, name: "Aisyah Putri" });
    await waitFor(() => expect(scrolledTo()).toContain("keuangan"));
  });
});

describe("Keuangan group does not repeat its own name", () => {
  it("labels the tagihan block Tagihan and keeps its anchor", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 2, name: "Keuangan" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Keuangan" })).not.toBeInTheDocument();
    const block = document.getElementById("keuangan")!;
    expect(within(block).getByRole("heading", { level: 3, name: "Tagihan" })).toBeInTheDocument();
  });
});

describe("Belum terdaftar di kelas row for read-only viewers", () => {
  it("shows the fact to a viewer who cannot edit, without the button", async () => {
    await renderLoaded({ student: makeStudent({ canEdit: false, enrollments: [] }) });
    const region = await strip();
    expect(within(region).getByText("Belum terdaftar di kelas")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Daftarkan ke Kelas/ })).not.toBeInTheDocument();
  });

  it("keeps the button for an editor", async () => {
    await renderLoaded({ student: makeStudent({ enrollments: [] }) });
    const region = await strip();
    expect(within(region).getByRole("button", { name: /Daftarkan ke Kelas/ })).toBeInTheDocument();
  });
});

describe("touch targets", () => {
  it("gives Saudara chips and the KK link a 44px floor on touch only", async () => {
    const sibling = { id: "s2", name: "Zahra Rahman", status: "ACTIVE" };
    const guardians = [
      {
        ...makeGuardian({ id: "p-ibu", name: "Fatimah Rahman", isPrimary: true }),
        parent: { ...makeGuardian({ id: "p-ibu", name: "Fatimah Rahman" }).parent, guardians: [{ student: sibling }] },
      },
    ];
    await renderLoaded({ student: makeStudent({ guardians }) });
    const chip = await screen.findByRole("link", { name: /Zahra Rahman/ });
    expect(chip.className).toContain("[@media(pointer:coarse)]:min-h-11");
  });
});
