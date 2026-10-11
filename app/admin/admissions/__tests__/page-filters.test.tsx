/**
 * Pendaftaran filters: Tahap select, Belum bayar toggle and search all live in the URL
 * (`?tahap=`, `?payment=unpaid`, `?search=`, `?page=`), so a dashboard link, a reload
 * and the back button land on the same view, and each change reads the list again with
 * the matching params.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdmissionsPage from "@/app/admin/admissions/page";
import { leadRow, listReads, navStore, reply, serveList } from "./helpers";

vi.mock("next/navigation", async () => (await import("./helpers")).navigationMock());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  navStore.reset();
});

const lastRead = (f: ReturnType<typeof serveList>) => listReads(f).at(-1)!;

describe("AdmissionsPage — filters", () => {
  it("offers Tahap with every stage and no Status filter", async () => {
    serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    expect(screen.queryByRole("combobox", { name: "Filter Status" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Filter Tahap" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Semua tahap", "Baru", "Formulir dikirim", "Formulir masuk", "Diterima", "Siswa", "Ditolak", "Batal"]);
  });

  it("choosing a Tahap writes ?tahap= and reads the list with it", async () => {
    const fetchMock = serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(lastRead(fetchMock).has("tahap")).toBe(false);

    await user.click(screen.getByRole("combobox", { name: "Filter Tahap" }));
    await user.click(await screen.findByRole("option", { name: "Formulir masuk" }));

    await waitFor(() => expect(lastRead(fetchMock).get("tahap")).toBe("FORMULIR_MASUK"));
    expect(navStore.params().get("tahap")).toBe("FORMULIR_MASUK");
    expect(screen.getByRole("combobox", { name: "Filter Tahap" })).toHaveTextContent("Formulir masuk");
  });

  it("the Belum bayar toggle writes ?payment=unpaid and reads the list with it", async () => {
    const fetchMock = serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    const toggle = screen.getByRole("button", { name: "Belum bayar" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);

    await waitFor(() => expect(lastRead(fetchMock).get("payment")).toBe("unpaid"));
    expect(navStore.params().get("payment")).toBe("unpaid");
    expect(screen.getByRole("button", { name: "Belum bayar" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Belum bayar" }));
    await waitFor(() => expect(lastRead(fetchMock).has("payment")).toBe(false));
    expect(navStore.params().has("payment")).toBe(false);
  });

  it("starts from the URL: a dashboard link lands on the filtered view", async () => {
    navStore.reset("tahap=FORMULIR_DIKIRIM&payment=unpaid&search=dewi&page=2");
    const fetchMock = serveList([leadRow()]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    const first = listReads(fetchMock)[0];
    expect(first.get("tahap")).toBe("FORMULIR_DIKIRIM");
    expect(first.get("payment")).toBe("unpaid");
    expect(first.get("search")).toBe("dewi");
    expect(first.get("page")).toBe("2");
    expect(screen.getByRole("combobox", { name: "Filter Tahap" })).toHaveTextContent("Formulir dikirim");
    expect(screen.getByRole("button", { name: "Belum bayar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: /Cari nama anak/ })).toHaveValue("dewi");
  });

  it("ignores a ?tahap= that is not a stage, and any retired ?status=", async () => {
    navStore.reset("tahap=BANANA&status=ADMITTED");
    const fetchMock = serveList([leadRow()]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    const first = listReads(fetchMock)[0];
    expect(first.has("tahap")).toBe(false);
    expect(first.has("status")).toBe(false);
    expect(screen.getByRole("combobox", { name: "Filter Tahap" })).toHaveTextContent("Semua tahap");
  });

  it("typing in the search box writes ?search= and starts again from page 1", async () => {
    navStore.reset("page=3");
    const fetchMock = serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    await user.type(screen.getByRole("textbox", { name: /Cari nama anak/ }), "dewi");

    await waitFor(() => expect(lastRead(fetchMock).get("search")).toBe("dewi"));
    expect(lastRead(fetchMock).has("page")).toBe(true);
    expect(lastRead(fetchMock).get("page")).toBe("1");
    expect(navStore.params().get("search")).toBe("dewi");
    expect(navStore.params().has("page")).toBe(false);
  });

  it("changing a filter drops the page", async () => {
    navStore.reset("page=3");
    const fetchMock = serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    await user.click(screen.getByRole("button", { name: "Belum bayar" }));
    await waitFor(() => expect(lastRead(fetchMock).get("payment")).toBe("unpaid"));
    expect(lastRead(fetchMock).get("page")).toBe("1");
  });

  it("Atur Ulang clears the Tahap, the toggle and the search together", async () => {
    navStore.reset("tahap=BARU&payment=unpaid&search=dewi");
    const fetchMock = serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    await user.click(screen.getByRole("button", { name: "Atur Ulang" }));

    await waitFor(() => expect(navStore.params().toString()).toBe(""));
    await waitFor(() => {
      const read = lastRead(fetchMock);
      expect(read.has("tahap")).toBe(false);
      expect(read.has("payment")).toBe(false);
      expect(read.has("search")).toBe(false);
    });
  });

  it("a filter with no match says nothing matches, not 'no inquiries yet'", async () => {
    navStore.reset("payment=unpaid");
    serveList([]);
    render(<AdmissionsPage />);
    expect(await screen.findByText("Tidak ada hasil yang cocok")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada calon siswa. Catat pertanyaan pertama.")).not.toBeInTheDocument();
  });
});

describe("AdmissionsPage — stat cards are filters", () => {
  it("each card applies its own filter, alone, and says whether it is on", async () => {
    navStore.reset("search=dewi&payment=unpaid");
    const fetchMock = serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    await user.click(screen.getByRole("button", { name: "Baru: 5" }));
    await waitFor(() => expect(lastRead(fetchMock).get("tahap")).toBe("BARU"));
    expect(lastRead(fetchMock).has("payment")).toBe(false);
    expect(lastRead(fetchMock).has("search")).toBe(false);
    expect(screen.getByRole("button", { name: "Baru: 5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: /Cari nama anak/ })).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Formulir masuk: 1" }));
    await waitFor(() => expect(lastRead(fetchMock).get("tahap")).toBe("FORMULIR_MASUK"));
    expect(screen.getByRole("button", { name: "Baru: 5" })).toHaveAttribute("aria-pressed", "false");

    // Belum bayar = the same unpaid filter as the toggle, and its count is the one that matches.
    await user.click(screen.getByRole("button", { name: "Belum bayar: 4" }));
    await waitFor(() => expect(lastRead(fetchMock).get("payment")).toBe("unpaid"));
    expect(lastRead(fetchMock).has("tahap")).toBe(false);
    expect(screen.getByRole("button", { name: "Belum bayar" })).toHaveAttribute("aria-pressed", "true");

    // Pressing the active card, or Total, shows everything again.
    await user.click(screen.getByRole("button", { name: "Belum bayar: 4" }));
    await waitFor(() => expect(navStore.params().toString()).toBe(""));
    await user.click(screen.getByRole("button", { name: "Baru: 5" }));
    await waitFor(() => expect(navStore.params().get("tahap")).toBe("BARU"));
    await user.click(screen.getByRole("button", { name: "Total: 12" }));
    await waitFor(() => expect(navStore.params().toString()).toBe(""));
    expect(screen.getByRole("button", { name: "Total: 12" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("AdmissionsPage — page past the end", () => {
  it("goes to the last page that has rows instead of showing the empty state", async () => {
    navStore.reset("page=3");
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const q = new URLSearchParams(String(input).split("?")[1]);
      const page = Number(q.get("page"));
      const rows = page === 2 ? [leadRow({ childName: "Dari halaman dua" })] : [];
      return Promise.resolve(
        reply({ data: rows, pagination: { page, pageSize: 20, total: 21, totalPages: 2 }, canEdit: true, stats: null }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdmissionsPage />);

    expect(await screen.findByText("Dari halaman dua")).toBeInTheDocument();
    expect(navStore.params().get("page")).toBe("2");
    expect(screen.queryByText("Belum ada calon siswa. Catat pertanyaan pertama.")).not.toBeInTheDocument();
    expect(screen.queryByText("Tidak ada hasil yang cocok")).not.toBeInTheDocument();
  });

  it("an empty page 1 is the real empty state, not a redirect", async () => {
    const fetchMock = serveList([]);
    render(<AdmissionsPage />);
    expect(await screen.findByText("Belum ada calon siswa. Catat pertanyaan pertama.")).toBeInTheDocument();
    expect(navStore.replace).not.toHaveBeenCalled();
    expect(listReads(fetchMock)).toHaveLength(1);
  });
});

describe("AdmissionsPage — search box and result count", () => {
  it("follows the URL when it changes by back/forward, without fighting typing", async () => {
    navStore.reset("search=dewi");
    serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    const box = await screen.findByRole("textbox", { name: /Cari nama anak/ });
    expect(box).toHaveValue("dewi");

    // Browser back to a view with another search, then to one with none.
    act(() => navStore.replace("/admin/admissions?search=fatimah"));
    await waitFor(() => expect(box).toHaveValue("fatimah"));
    act(() => navStore.replace("/admin/admissions"));
    await waitFor(() => expect(box).toHaveValue(""));

    // Typing is never overwritten by the URL catching up.
    await user.type(box, "budi");
    expect(box).toHaveValue("budi");
    await waitFor(() => expect(navStore.params().get("search")).toBe("budi"));
    expect(box).toHaveValue("budi");
  });

  it("announces the result count politely once the rows are here", async () => {
    serveList([leadRow(), leadRow({ id: "a2", childName: "Bilal" })]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(screen.getByRole("status")).toHaveTextContent("2 pendaftaran");
  });

  it("says nothing while the rows are loading", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AdmissionsPage />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
