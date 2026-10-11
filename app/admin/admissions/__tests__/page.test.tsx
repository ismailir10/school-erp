/**
 * The unified Pendaftaran list (cycle 2026-10-11-pendaftaran-simplify, T8): one list
 * with Tahap and Pembayaran per row, stat cards that ride on the same single request,
 * the lead dialog behind "Catat Pertanyaan" and the row's name, and the
 * `?edit=<id>` deep link the formulir page uses for "Data kontak".
 * Filters and row actions: page-filters.test.tsx, page-actions.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdmissionsPage from "@/app/admin/admissions/page";
import { formulir, leadRow, listReads, navStore, reply, serveList, STATS } from "./helpers";

vi.mock("next/navigation", async () => (await import("./helpers")).navigationMock());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(async () => {
  navStore.reset();
  const { toast } = await import("sonner");
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe("AdmissionsPage — one list", () => {
  it("shows the stat cards from the same single request that returns the rows", async () => {
    const fetchMock = serveList([leadRow()]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");

    // "Baru" is also a row chip; the card is the one inside a StatCard.
    const card = (label: string) =>
      within(screen.getAllByText(label).map((el) => el.closest("[data-index]")).find(Boolean) as HTMLElement);
    expect(card("Total").getByText("12")).toBeInTheDocument();
    expect(card("Baru").getByText("5")).toBeInTheDocument();
    // Same set as the Belum bayar filter (every open unpaid fee), not just sent formulirs.
    expect(card("Belum bayar").getByText("4")).toBeInTheDocument();
    expect(card("Formulir masuk").getByText("1")).toBeInTheDocument();

    // One list read; no extra counting requests, no per-status filter.
    const reads = listReads(fetchMock);
    expect(reads).toHaveLength(1);
    expect(reads[0].get("pageSize")).toBe("20");
    expect(reads[0].has("status")).toBe(false);
    // The legacy cards are gone.
    expect(screen.queryByText("Pertanyaan")).not.toBeInTheDocument();
    expect(screen.queryByText("Total Calon")).not.toBeInTheDocument();
  });

  it("shows the formulir's program, not the lead's unset one, once a formulir exists", async () => {
    serveList([
      leadRow({ program: null, stage: "FORMULIR_DIKIRIM", application: formulir({ programName: "Day Care" }) }),
      leadRow({ id: "a2", childName: "Bima", program: null }),
    ]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(screen.getByText("Day Care")).toBeInTheDocument();
    expect(screen.getAllByText("Belum dipilih")).toHaveLength(1);
  });

  it("shows a dash instead of a count until the stats are here", async () => {
    serveList([leadRow()], { stats: null });
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    const total = screen.getByText("Total").closest("[data-index]") as HTMLElement;
    expect(within(total).getByText("—")).toBeInTheDocument();
  });

  it("has Anak, Program, Tahap, Pembayaran, Dibuat and Saudara columns; no second date column", async () => {
    serveList([leadRow()]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Anak", "Program", "Tahap", "Pembayaran", "Dibuat", "Saudara", ""]);
    expect(screen.queryByRole("columnheader", { name: "Tanggal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Sumber" })).not.toBeInTheDocument();
  });

  it("names the child with age when the date of birth is known, the parent and a contact beneath", async () => {
    serveList([leadRow({ dateOfBirth: "2021-01-01", parentPhone: "0811111111", parentWhatsapp: "08215678901" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByText(/Dewi Sartika · 0811111111/)).toBeInTheDocument();
    expect(screen.queryByText(/WA 08215678901/)).not.toBeInTheDocument();
    expect(screen.getByText(/\d+ tahun/)).toBeInTheDocument();
  });

  it("falls back to the WhatsApp number when there is no phone", async () => {
    serveList([leadRow({ parentWhatsapp: "08215678901" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByText(/Dewi Sartika · WA 08215678901/)).toBeInTheDocument();
  });

  it("writes 'Belum diisi' for a lead with no child name", async () => {
    serveList([leadRow({ childName: "" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByText("Belum diisi")).toBeInTheDocument();
  });

  it("shows Tahap and Pembayaran as chips, and a dash for a row with no fee", async () => {
    serveList([
      leadRow({ id: "a1", childName: "Aisyah" }),
      leadRow({
        id: "a2", childName: "Bilal", stage: "FORMULIR_DIKIRIM", payment: "UNPAID",
        application: formulir({ id: "ea-2", fee: { status: "UNPAID", amount: 300000, canRemind: true } }),
      }),
      leadRow({ id: "a3", childName: "Citra", stage: "FORMULIR_MASUK", payment: "PAID", application: formulir({ id: "ea-3", status: "SUBMITTED" }) }),
    ]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    const rowOf = (name: string) => within(screen.getByText(name).closest("tr") as HTMLElement);

    expect(rowOf("Aisyah").getAllByText("Baru").length).toBeGreaterThan(0);
    expect(rowOf("Aisyah").getByText("Tanpa biaya")).toBeInTheDocument();
    expect(rowOf("Bilal").getAllByText("Formulir dikirim").length).toBeGreaterThan(0);
    expect(rowOf("Bilal").getAllByText("Belum bayar").length).toBeGreaterThan(0);
    expect(rowOf("Bilal").getByText("Rp 300.000")).toBeInTheDocument();
    expect(rowOf("Citra").getAllByText("Formulir masuk").length).toBeGreaterThan(0);
    expect(rowOf("Citra").getAllByText("Lunas").length).toBeGreaterThan(0);
  });

  it("never shows the retired visit or admit steps; a legacy lead reads as Baru", async () => {
    serveList([leadRow({ status: "VISITED", stage: "BARU" })]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(screen.queryByText("Sudah Kunjungan")).not.toBeInTheDocument();
    expect(screen.queryByText("Kunjungan")).not.toBeInTheDocument();
    expect(screen.getAllByText("Baru").length).toBeGreaterThan(0);
  });

  it("repeats Tahap and Pembayaran under the name for phones (hidden from md up)", async () => {
    serveList([leadRow({ stage: "FORMULIR_DIKIRIM", payment: "UNPAID", application: formulir({ fee: { status: "UNPAID", amount: 1000, canRemind: false } }) })]);
    render(<AdmissionsPage />);
    const name = await screen.findByText("Aisyah");
    const cell = name.closest("td") as HTMLElement;
    const meta = cell.querySelector(".md\\:hidden") as HTMLElement;
    expect(meta).not.toBeNull();
    expect(within(meta).getByText("Formulir dikirim")).toBeInTheDocument();
    expect(within(meta).getByText("Belum bayar")).toBeInTheDocument();
  });

  it("empty list: asks for the first inquiry, with the add button", async () => {
    serveList([]);
    render(<AdmissionsPage />);
    expect(await screen.findByText("Belum ada calon siswa. Catat pertanyaan pertama.")).toBeInTheDocument();
    // The header button and the empty state's button open the same dialog.
    expect(screen.getAllByRole("button", { name: "Catat Pertanyaan" })).toHaveLength(2);
  });

  it("empty list for a viewer: no add button, and no instruction to log an inquiry", async () => {
    serveList([], { canEdit: false });
    render(<AdmissionsPage />);
    expect(await screen.findByText("Belum ada calon siswa.")).toBeInTheDocument();
    expect(screen.queryByText(/Catat pertanyaan pertama/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Catat Pertanyaan" })).not.toBeInTheDocument();
  });

  it("a failed read says so, offers a retry and keeps the stat cards honest", async () => {
    let fail = true;
    serveList([leadRow()], {
      extra: (url) => (fail && url.startsWith("/api/admissions?") ? reply({ error: "x" }, 503) : undefined),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    expect(await screen.findByText("Gagal memuat data pendaftaran. Coba lagi.")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Aisyah")).toBeInTheDocument();
    expect(screen.queryByText("Gagal memuat data pendaftaran. Coba lagi.")).not.toBeInTheDocument();
  });
});

describe("AdmissionsPage — viewer", () => {
  it("has no add button, no menu and no send; a formulir row keeps its link", async () => {
    serveList(
      [
        leadRow({ id: "a1", childName: "Aisyah" }),
        leadRow({ id: "a2", childName: "Citra", stage: "FORMULIR_MASUK", application: formulir({ id: "ea-3", status: "SUBMITTED" }) }),
      ],
      { canEdit: false },
    );
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(screen.queryByRole("button", { name: "Catat Pertanyaan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Aksi untuk/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Kirim/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buka formulir: Citra" })).toHaveAttribute("href", "/admin/enrollments/ea-3");
    expect(screen.getByText("Hanya lihat")).toBeInTheDocument();
    // Without a formulir the name is plain text: a viewer cannot open the lead dialog.
    expect(screen.queryByRole("button", { name: "Aisyah" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Aisyah" })).not.toBeInTheDocument();
  });
});

describe("AdmissionsPage — row click", () => {
  it("opens the formulir detail when the lead has a formulir", async () => {
    serveList([leadRow({ stage: "FORMULIR_DIKIRIM", application: formulir({ id: "ea-9" }) })]);
    render(<AdmissionsPage />);
    expect(await screen.findByRole("link", { name: "Aisyah" })).toHaveAttribute("href", "/admin/enrollments/ea-9");
  });

  it("opens the lead dialog, prefilled, when there is no formulir yet", async () => {
    serveList([leadRow({ parentPhone: "0811111111", notes: "Datang sore" })]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await user.click(await screen.findByRole("button", { name: "Aisyah" }));
    const dialog = await screen.findByRole("dialog", { name: "Ubah data pertanyaan" });
    expect(within(dialog).getByLabelText(/^Nama orang tua\*?$/)).toHaveValue("Dewi Sartika");
    expect(within(dialog).getByLabelText("No. HP")).toHaveValue("0811111111");
  });

  it("a student without a formulir links to the student", async () => {
    serveList([leadRow({ stage: "SISWA", studentId: "stu-1" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByRole("link", { name: "Aisyah" })).toHaveAttribute("href", "/admin/students/stu-1");
  });
});

// "Catat Pertanyaan": react-hook-form + zodResolver (`createAdmissionSchema`).
describe("AdmissionsPage — Catat Pertanyaan dialog (RHF)", () => {
  const withPost = (rows: unknown[] = []) =>
    serveList(rows, {
      extra: (url, init) => (url === "/api/admissions" && init?.method === "POST" ? reply({ id: "a1" }) : undefined),
    });

  it("blocks an empty submit with inline errors and sends no request", async () => {
    withPost();
    const user = userEvent.setup();
    render(<AdmissionsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Catat Pertanyaan" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Catat Pertanyaan Baru" });

    const fetchSpy = vi.mocked(fetch);
    fetchSpy.mockClear();

    await user.click(within(dialog).getByRole("button", { name: "Catat Pertanyaan" }));

    expect(await within(dialog).findByText("Nama orang tua wajib diisi")).toBeInTheDocument();
    expect(within(dialog).queryByText("Nama anak wajib diisi")).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("asks for one contact when only the parent name is filled", async () => {
    withPost();
    const user = userEvent.setup();
    render(<AdmissionsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Catat Pertanyaan" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Catat Pertanyaan Baru" });
    await user.type(within(dialog).getByLabelText(/^Nama orang tua\*?$/), "Ibu Fatimah");
    vi.mocked(fetch).mockClear();

    await user.click(within(dialog).getByRole("button", { name: "Catat Pertanyaan" }));

    expect(await within(dialog).findByText("Isi minimal satu kontak: No. HP, WhatsApp atau Email")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("saves with only the parent name and a phone, then reads the list again", async () => {
    const fetchMock = withPost();
    const user = userEvent.setup();
    render(<AdmissionsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Catat Pertanyaan" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Catat Pertanyaan Baru" });

    // The child section is collapsed on a new lead; the removed lead fields are gone.
    expect(within(dialog).getByRole("button", { name: "Data anak (opsional)" })).toBeInTheDocument();
    for (const gone of [/Pendidikan/, /Pekerjaan/, /Penghasilan/, /Preferensi Kampus/, /Tanggal Tindak Lanjut/, /Sumber/]) {
      expect(within(dialog).queryByLabelText(gone)).not.toBeInTheDocument();
    }

    await user.type(within(dialog).getByLabelText(/^Nama orang tua\*?$/), "Ibu Fatimah");
    await user.type(within(dialog).getByLabelText("No. HP"), "081234567890");
    await user.click(within(dialog).getByRole("button", { name: "Catat Pertanyaan" }));

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pendaftaran tercatat"));

    const postCall = fetchMock.mock.calls.find(([u, init]) => u === "/api/admissions" && init?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall![1]!.body as string);
    expect(body.parentName).toBe("Ibu Fatimah");
    expect(body.parentPhone).toBe("081234567890");
    expect(body.childName).toBe("");
    for (const key of ["source", "parentEducation", "parentOccupation", "parentIncome", "campusPreference", "followUpDate"]) {
      expect(body).not.toHaveProperty(key);
    }
    // One read on load, one after the save: the stats come back with the rows.
    await waitFor(() => expect(listReads(fetchMock)).toHaveLength(2));
  });

  it("sends a cleared email as blank when editing, so the server can clear it", async () => {
    const lead = leadRow({ childName: "", parentName: "Ibu Fatimah", parentPhone: "081234567890", parentEmail: "fatimah@example.com" });
    const fetchMock = serveList([lead], {
      extra: (url, init) => (url === "/api/admissions/a1" && init?.method === "PUT" ? reply({}) : undefined),
    });

    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByText("Ibu Fatimah", { exact: false });
    await user.click(screen.getByRole("button", { name: /^Aksi untuk/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah data pertanyaan" }));
    const dialog = await screen.findByRole("dialog", { name: "Ubah data pertanyaan" });

    await user.clear(within(dialog).getByLabelText("Email"));
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const putInit = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")![1]!;
    const body = JSON.parse(putInit.body as string);
    expect(body.parentEmail).toBe("");
    expect(body.parentPhone).toBe("081234567890");
    expect(body.childName).toBe("");
  });
});

describe("AdmissionsPage — ?edit= deep link (Data kontak on the formulir page)", () => {
  it("opens that lead's dialog once the rows are here, and drops the param", async () => {
    navStore.reset("edit=a1&search=Dewi%20Sartika");
    const fetchMock = serveList([leadRow({ parentPhone: "0811111111" })]);
    render(<AdmissionsPage />);

    const dialog = await screen.findByRole("dialog", { name: "Ubah data pertanyaan" });
    expect(within(dialog).getByLabelText(/^Nama orang tua\*?$/)).toHaveValue("Dewi Sartika");
    expect(within(dialog).getByLabelText("No. HP")).toHaveValue("0811111111");
    // The list was read for that parent; the link is single use and its search goes with it.
    expect(listReads(fetchMock)[0].get("search")).toBe("Dewi Sartika");
    await waitFor(() => expect(navStore.params().has("edit")).toBe(false));
    expect(navStore.params().has("search")).toBe(false);
    // The dialog keeps its own copy of the lead while the list reloads unfiltered.
    await waitFor(() => expect(listReads(fetchMock).some((q) => !q.has("search"))).toBe(true));
    expect(screen.getByRole("dialog", { name: "Ubah data pertanyaan" })).toBeInTheDocument();
  });

  it("keeps ?edit= when the first read fails, so a reload retries", async () => {
    navStore.reset("edit=a1&search=Dewi");
    serveList([leadRow()], {
      extra: (url) => (url.startsWith("/api/admissions?") ? reply({ error: "x" }, 503) : undefined),
    });
    render(<AdmissionsPage />);
    await screen.findByText("Gagal memuat data pendaftaran. Coba lagi.");
    expect(navStore.params().get("edit")).toBe("a1");
    expect(navStore.params().get("search")).toBe("Dewi");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says so when the lead is not in the list, and opens nothing", async () => {
    navStore.reset("edit=zzz");
    serveList([leadRow()]);
    render(<AdmissionsPage />);
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "Data kontak tidak bisa diubah: pertanyaan ini sudah jadi siswa atau dibatalkan, atau tidak ada di daftar.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(navStore.params().has("edit")).toBe(false));
  });

  it("does not open a converted student's lead", async () => {
    navStore.reset("edit=a1");
    serveList([leadRow({ stage: "SISWA", studentId: "stu-1" })]);
    render(<AdmissionsPage />);
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens nothing for a viewer, but still cleans the URL", async () => {
    navStore.reset("edit=a1");
    serveList([leadRow()], { canEdit: false });
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    await waitFor(() => expect(navStore.params().has("edit")).toBe(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AdmissionsPage — stats shape", () => {
  it("is the documented set (guards the fixture against drifting from the contract)", () => {
    expect(Object.keys(STATS).sort()).toEqual(
      ["baru", "belumBayar", "diterima", "formulirDikirim", "formulirMasuk", "menungguBayar", "siswa", "total"],
    );
  });
});
