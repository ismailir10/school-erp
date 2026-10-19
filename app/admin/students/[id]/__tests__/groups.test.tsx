/**
 * The student page's five groups: the nav lists five, a closed group says what
 * is inside it (and an open one does not), every old anchor still opens what
 * contains it, and nothing lazy is requested before it is opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";
import {
  INVOICES_OWED,
  OVERVIEW_WITH_FORM,
  ResizeObserverStub,
  makeStudent,
  stubFetch,
  urlsMatching,
} from "./student-fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

const GROUP_IDS = ["group-profil", "group-keluarga", "group-kelas", "group-keuangan", "group-catatan"];

const groupTrigger = (id: string) => document.querySelector<HTMLElement>(`[aria-controls="${id}-content"]`)!;
const summaryOf = (id: string) => document.getElementById(id)?.querySelector("[data-slot='dossier-summary']") ?? null;

async function renderLoaded(opts: Parameters<typeof stubFetch>[0] = {}) {
  const { fn, calls } = stubFetch(opts);
  vi.stubGlobal("fetch", fn);
  render(<StudentDetailPage />);
  await screen.findByRole("heading", { level: 1, name: "Aisyah Putri" });
  return { calls };
}

describe("student page — five groups", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Element.prototype.scrollIntoView = vi.fn();
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("lists exactly five groups in the nav, in order", async () => {
    await renderLoaded();
    const nav = screen.getByRole("navigation", { name: "Bagian halaman" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Profil",
      "Keluarga & Berkas",
      "Kelas & Akademik",
      "Keuangan",
      "Pendaftaran & Catatan",
    ]);
    for (const id of GROUP_IDS) expect(document.getElementById(id)).not.toBeNull();
  });

  it("keeps every old anchor id on the page", async () => {
    await renderLoaded({ student: makeStudent({ status: "WITHDRAWN" }), overview: OVERVIEW_WITH_FORM });
    await waitFor(() => expect(document.getElementById("pendaftaran")).not.toBeNull());
    for (const id of [
      "data-anak", "kesehatan", "keluarga", "riwayat-kelas", "kehadiran", "keuangan", "keringanan",
      "buku-penghubung", "akademik", "pendaftaran", "dokumen", "riwayat-status", "informasi-tambahan",
    ]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it("opens Profil, Keluarga & Berkas and Keuangan on desktop; Kelas and Catatan start closed", async () => {
    await renderLoaded();
    const expanded = (id: string) => groupTrigger(id).getAttribute("aria-expanded");
    expect(GROUP_IDS.map(expanded)).toEqual(["true", "true", "false", "true", "false"]);
  });

  it("shows a closed group's one-line summary and hides it once opened", async () => {
    const user = userEvent.setup();
    await renderLoaded({ invoices: INVOICES_OWED });
    await waitFor(() => expect(summaryOf("group-kelas")?.textContent).toContain("Hadir 18/20"));
    expect(summaryOf("group-kelas")).toHaveTextContent("KB A · Hadir 18/20 · Raport 0/2 terbit");

    await user.click(groupTrigger("group-kelas"));
    expect(summaryOf("group-kelas")).toBeNull();
    expect(screen.getByText("Kelas saat ini")).toBeInTheDocument();

    // Open groups carry no summary; closing one brings it back.
    expect(summaryOf("group-profil")).toBeNull();
    await user.click(groupTrigger("group-profil"));
    expect(summaryOf("group-profil")).toHaveTextContent("NIS 2026-0142 · Laki-laki · Alergi kacang");
  });

  it("summarises Keluarga & Berkas and Keuangan when they are collapsed", async () => {
    const user = userEvent.setup();
    await renderLoaded({ invoices: INVOICES_OWED });
    await user.click(groupTrigger("group-keluarga"));
    await user.click(groupTrigger("group-keuangan"));
    // Foto siswa present, KK present (primary wali), two KTP present: 4/4.
    expect(summaryOf("group-keluarga")).toHaveTextContent("2 wali · Berkas 4/4");
    await waitFor(() => expect(summaryOf("group-keuangan")).toHaveTextContent("Rp 1.250.000 belum dibayar"));
  });

  it("says Input manual for a hand-entered child and the date for a formulir child", async () => {
    await renderLoaded();
    await waitFor(() => expect(summaryOf("group-catatan")).toHaveTextContent("Input manual"));
  });

  it("names the formulir date in the Pendaftaran & Catatan summary", async () => {
    await renderLoaded({ overview: OVERVIEW_WITH_FORM });
    await waitFor(() => expect(summaryOf("group-catatan")).toHaveTextContent("Formulir 12 Sep 2026"));
  });

  it("requests nothing lazy before a row is opened", async () => {
    const { calls } = await renderLoaded({ overview: OVERVIEW_WITH_FORM });
    await waitFor(() => expect(urlsMatching(calls, "/overview")).toHaveLength(1));
    for (const needle of ["/attendance", "/academics", "/enrollment-application", "/api/student-fee-adjustments", "/api/student-journal/"]) {
      expect(urlsMatching(calls, needle), needle).toHaveLength(0);
    }
  });

  it("opening a closed group alone does not fetch its lazy rows", async () => {
    const user = userEvent.setup();
    const { calls } = await renderLoaded({ overview: OVERVIEW_WITH_FORM });
    await user.click(groupTrigger("group-kelas"));
    await user.click(groupTrigger("group-catatan"));
    expect(urlsMatching(calls, "/attendance")).toHaveLength(0);
    expect(urlsMatching(calls, "/academics")).toHaveLength(0);
    expect(urlsMatching(calls, "/enrollment-application")).toHaveLength(0);
    expect(urlsMatching(calls, "/api/student-journal/")).toHaveLength(0);
  });

  it("opens the closed group for the nav, then fetches once for a lazy row opened inside it", async () => {
    const user = userEvent.setup();
    const { calls } = await renderLoaded();
    await user.click(within(screen.getByRole("navigation", { name: "Bagian halaman" })).getByRole("button", { name: "Kelas & Akademik" }));
    expect(groupTrigger("group-kelas").getAttribute("aria-expanded")).toBe("true");

    const akademik = document.getElementById("akademik")!.querySelector<HTMLElement>("[data-slot='collapsible-trigger']")!;
    await user.click(akademik);
    await waitFor(() => expect(urlsMatching(calls, "/academics")).toHaveLength(1));
    await user.click(akademik);
    await user.click(akademik);
    expect(urlsMatching(calls, "/academics")).toHaveLength(1);
  });

  describe("deep links", () => {
    it("#pendaftaran opens Pendaftaran & Catatan and the form row, fetching once", async () => {
      window.location.hash = "#pendaftaran";
      const { calls } = await renderLoaded({ overview: OVERVIEW_WITH_FORM });
      await waitFor(() => expect(urlsMatching(calls, "/enrollment-application")).toHaveLength(1));
      expect(groupTrigger("group-catatan").getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector('[aria-controls="pendaftaran-content"]')?.getAttribute("aria-expanded")).toBe("true");
    });

    it("#akademik opens Kelas & Akademik and fetches the academics once", async () => {
      window.location.hash = "#akademik";
      const { calls } = await renderLoaded();
      await waitFor(() => expect(urlsMatching(calls, "/academics")).toHaveLength(1));
      expect(groupTrigger("group-kelas").getAttribute("aria-expanded")).toBe("true");
    });

    it("#keuangan lands in an already-open group without fetching anything extra", async () => {
      window.location.hash = "#keuangan";
      const { calls } = await renderLoaded({ invoices: INVOICES_OWED });
      await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
      expect(groupTrigger("group-keuangan").getAttribute("aria-expanded")).toBe("true");
      expect(urlsMatching(calls, "/api/invoices")).toHaveLength(1);
      expect(urlsMatching(calls, "/api/student-fee-adjustments")).toHaveLength(0);
    });

    it("a group id works as a hash too", async () => {
      window.location.hash = "#group-catatan";
      await renderLoaded();
      await waitFor(() => expect(groupTrigger("group-catatan").getAttribute("aria-expanded")).toBe("true"));
    });

    it("ignores #pendaftaran for a child who did not come from a formulir", async () => {
      window.location.hash = "#pendaftaran";
      await renderLoaded();
      await waitFor(() => expect(summaryOf("group-catatan")).toHaveTextContent("Input manual"));
      expect(groupTrigger("group-catatan").getAttribute("aria-expanded")).toBe("false");
    });
  });
});
