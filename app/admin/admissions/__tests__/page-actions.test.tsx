/**
 * What a Pendaftaran row offers, by stage: one visible primary action plus an overflow
 * menu, and the dialogs they open (Kirim formulir and its result card, the cancel
 * confirm). A lead stored with a retired status arrives as stage BARU and behaves as BARU.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AdmissionsPage from "@/app/admin/admissions/page";
import { formulir, leadRow, listReads, navStore, reply, serveList } from "./helpers";

vi.mock("next/navigation", async () => (await import("./helpers")).navigationMock());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(async () => {
  navStore.reset();
  const { toast } = await import("sonner");
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

type User = ReturnType<typeof userEvent.setup>;
const openMenu = async (user: User) => {
  await user.click(await screen.findByRole("button", { name: /^Aksi untuk/ }));
};
const menuLabels = async (user: User) => {
  await openMenu(user);
  return (await screen.findAllByRole("menuitem")).map((i) => i.textContent?.trim());
};

describe("row actions by stage", () => {
  it("BARU: Kirim Formulir leads; the menu has Ubah data pertanyaan and Batalkan", async () => {
    serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    expect(await screen.findByRole("button", { name: "Kirim Formulir: Aisyah" })).toBeInTheDocument();
    expect(await menuLabels(user)).toEqual(["Ubah data pertanyaan", "Batalkan"]);
  });

  it("FORMULIR_DIKIRIM: Kirim ulang tautan leads; no reminder when it cannot be sent", async () => {
    serveList([
      leadRow({
        stage: "FORMULIR_DIKIRIM", payment: "UNPAID",
        application: formulir({ fee: { status: "UNPAID", amount: 300000, canRemind: false } }),
      }),
    ]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    expect(await screen.findByRole("button", { name: "Kirim ulang tautan: Aisyah" })).toBeInTheDocument();
    expect(await menuLabels(user)).toEqual(["Ubah data pertanyaan", "Batalkan"]);
  });

  it("FORMULIR_DIKIRIM with canRemind: the menu offers the WhatsApp reminder, which opens the reminder endpoint", async () => {
    serveList([
      leadRow({
        stage: "FORMULIR_DIKIRIM", payment: "UNPAID",
        application: formulir({ id: "ea-7", fee: { status: "UNPAID", amount: 300000, canRemind: true } }),
      }),
    ]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await screen.findByRole("button", { name: "Kirim ulang tautan: Aisyah" });
    expect(await menuLabels(user)).toEqual(["Ingatkan bayar (WhatsApp)", "Ubah data pertanyaan", "Batalkan"]);
    const reminder = screen.getByRole("menuitem", { name: "Ingatkan bayar (WhatsApp)" });
    expect(reminder).toHaveAttribute("href", "/api/enrollments/ea-7/fee/reminder");
    expect(reminder).toHaveAttribute("target", "_blank");
    expect(reminder).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it.each([
    ["FORMULIR_MASUK", "SUBMITTED"],
    ["DITERIMA", "ACCEPTED"],
    ["DITOLAK", "REJECTED"],
  ])("%s: Buka formulir links to the detail page", async (stage, status) => {
    serveList([leadRow({ stage, application: formulir({ id: "ea-5", status }) })]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    const link = await screen.findByRole("link", { name: "Buka formulir: Aisyah" });
    expect(link).toHaveAttribute("href", "/admin/enrollments/ea-5");
    // Still a lead that can be corrected or cancelled.
    expect(await menuLabels(user)).toContain("Ubah data pertanyaan");
  });

  it("SISWA: Lihat siswa links to the student, and there is no menu", async () => {
    serveList([leadRow({ stage: "SISWA", studentId: "stu-1", application: formulir({ id: "ea-5", status: "ACCEPTED", studentId: "stu-1" }) })]);
    render(<AdmissionsPage />);
    const link = await screen.findByRole("link", { name: "Lihat siswa: Aisyah" });
    expect(link).toHaveAttribute("href", "/admin/students/stu-1");
    expect(screen.queryByRole("button", { name: /^Aksi untuk/ })).not.toBeInTheDocument();
  });

  it("SISWA converted through the formulir only: the student id comes from the formulir", async () => {
    serveList([leadRow({ stage: "SISWA", studentId: null, application: formulir({ status: "ACCEPTED", studentId: "stu-2" }) })]);
    render(<AdmissionsPage />);
    expect(await screen.findByRole("link", { name: "Lihat siswa: Aisyah" })).toHaveAttribute("href", "/admin/students/stu-2");
  });

  it("BATAL: nothing to do", async () => {
    serveList([leadRow({ stage: "BATAL", status: "CANCELLED" })]);
    render(<AdmissionsPage />);
    await screen.findByText("Aisyah");
    expect(screen.queryByRole("button", { name: /Aisyah$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Aisyah$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Aksi untuk/ })).not.toBeInTheDocument();
  });

  it("a lead stored as VISITED (stage BARU) is offered exactly what a Baru lead is", async () => {
    serveList([leadRow({ status: "VISITED", stage: "BARU" })]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    expect(await screen.findByRole("button", { name: "Kirim Formulir: Aisyah" })).toBeInTheDocument();
    const labels = await menuLabels(user);
    expect(labels).toEqual(["Ubah data pertanyaan", "Batalkan"]);
    for (const retired of ["Jadwalkan kunjungan", "Tandai sudah berkunjung", "Terima"]) {
      expect(labels).not.toContain(retired);
    }
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names the parent for the row buttons while the child is not named yet", async () => {
    serveList([leadRow({ childName: "" })]);
    render(<AdmissionsPage />);
    expect(await screen.findByRole("button", { name: "Kirim Formulir: Dewi Sartika" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aksi untuk Dewi Sartika" })).toBeInTheDocument();
  });
});

describe("Batalkan", () => {
  it("asks first, then cancels the lead (PUT status CANCELLED) and reads the list again", async () => {
    const fetchMock = serveList([leadRow()], {
      extra: (url, init) => (url === "/api/admissions/a1" && init?.method === "PUT" ? reply({}) : undefined),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/pendaftaran Aisyah/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Ya, Batalkan" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({ status: "CANCELLED" });
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pendaftaran dibatalkan"));
    await waitFor(() => expect(listReads(fetchMock)).toHaveLength(2));
  });

  it("a lead that became a student meanwhile (409): shows the server's words, closes, and reads the list again", async () => {
    const fetchMock = serveList([leadRow()], {
      extra: (url, init) =>
        url === "/api/admissions/a1" && init?.method === "PUT"
          ? reply({ error: "Calon siswa ini sudah menjadi siswa, jadi tidak bisa dibatalkan." }, 409)
          : undefined,
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Ya, Batalkan" }));

    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Calon siswa ini sudah menjadi siswa, jadi tidak bisa dibatalkan."),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(listReads(fetchMock)).toHaveLength(2));
  });

  it.each([
    [403, "Anda tidak memiliki izin untuk tindakan ini."],
    [429, "Terlalu banyak permintaan, coba lagi sebentar."],
  ])("a %s shows the server's words and keeps the dialog open to retry", async (status, text) => {
    serveList([leadRow()], {
      extra: (url, init) =>
        url === "/api/admissions/a1" && init?.method === "PUT" ? reply({ error: text }, status) : undefined,
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Ya, Batalkan" }));

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(text));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("an unreadable failure falls back to the plain Indonesian sentence", async () => {
    serveList([leadRow()], {
      extra: (url, init) => (url === "/api/admissions/a1" && init?.method === "PUT" ? reply({}, 400) : undefined),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Ya, Batalkan" }));
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gagal membatalkan pendaftaran. Coba lagi."));
  });

  it("warns that an unpaid payment link closes with the lead", async () => {
    serveList([
      leadRow({
        stage: "FORMULIR_DIKIRIM", payment: "UNPAID",
        application: formulir({ fee: { status: "UNPAID", amount: 300000, canRemind: false } }),
      }),
    ]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan" }));
    expect(await screen.findByText(/Tautan pembayaran formulir yang belum dibayar ikut ditutup/)).toBeInTheDocument();
  });

  it("keeping the lead returns focus to its row", async () => {
    serveList([leadRow()]);
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^Batal/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Aksi untuk Aisyah" })).toHaveFocus());
  });
});

describe("editing a lead from the row", () => {
  it("returns focus to the row once the list is back", async () => {
    serveList([leadRow({ parentPhone: "0811111111" })], {
      extra: (url, init) => (url === "/api/admissions/a1" && init?.method === "PUT" ? reply({}) : undefined),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Ubah data pertanyaan" }));
    const dialog = await screen.findByRole("dialog", { name: "Ubah data pertanyaan" });
    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Aksi untuk Aisyah" })).toHaveFocus());
  });
});

describe("Kirim formulir", () => {
  const PROGRAMS = [
    { id: "prog-1", code: "TK", name: "TK A", enrollmentFee: 300000 },
    { id: "prog-2", code: "DCARE", name: "Day Care", enrollmentFee: 150000 },
  ];
  /** The config list, plus the invite answered by `inviteReply`. */
  const invite = (inviteReply: Response) => (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/config/enrollment")) return reply({ programs: PROGRAMS });
    if (url.endsWith("/api/enrollments/invite") && init?.method === "POST") return inviteReply;
    return undefined;
  };
  const sent = (body: Record<string, unknown>) => reply({ id: "ea-1", created: true, fee: null, ...body });

  async function openKirim(user: User, name = "Kirim Formulir: Aisyah") {
    await user.click(await screen.findByRole("button", { name }));
    return screen.findByRole("dialog", { name: "Kirim formulir" });
  }
  async function clickKirim(user: User) {
    const ask = await openKirim(user);
    // The lead's program is prefilled once the prices are here.
    await waitFor(() => expect(within(ask).getByTestId("kirim-formulir-fee")).toHaveTextContent("Rp 300.000"));
    await user.click(within(ask).getByRole("button", { name: "Kirim formulir" }));
  }

  it("asks for the program first: the lead's program is prefilled and nothing is sent until Kirim formulir", async () => {
    const fetchMock = serveList(
      [leadRow({ programId: "prog-1", program: { name: "TK A" } })],
      { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-1" })) },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    const ask = await openKirim(user);
    await waitFor(() => expect(within(ask).getByTestId("kirim-formulir-fee")).toHaveTextContent("Biaya formulir: Rp 300.000"));
    expect(within(ask).getByRole("combobox", { name: /Program/ })).toHaveTextContent("TK A");
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/api/enrollments/invite"))).toBe(false);
  });

  it("a walk-in with only a phone gets the card: link, WhatsApp and fill-together, no email wording", async () => {
    const fetchMock = serveList(
      [leadRow({ parentPhone: "0812-3456-7890", programId: "prog-1", program: { name: "TK A" } })],
      { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-1", emailed: false, hasEmail: false })) },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirim(user);

    const dialog = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(dialog).getByText("Tidak ada email — bagikan lewat WhatsApp")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tautan formulir")).toHaveValue("https://talib.example/pendaftaran/tok-1");
    expect(within(dialog).getByRole("link", { name: "Kirim lewat WhatsApp (tab baru)" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/6281234567890?text="),
    );
    expect(within(dialog).getByRole("link", { name: "Isi bersama orang tua (tab baru)" })).toHaveAttribute(
      "href",
      "https://talib.example/pendaftaran/tok-1",
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/enrollments/invite"))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ admissionId: "a1" });
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reads the list again when the card closes, and returns focus to the row", async () => {
    const fetchMock = serveList(
      [leadRow({ parentPhone: "0812-3456-7890", programId: "prog-1", program: { name: "TK A" } })],
      { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-1" })) },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirim(user);
    const card = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    await user.click(within(card).getByRole("button", { name: "Selesai" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Once after the send, once when the card closes (the fee may have been settled on it).
    await waitFor(() => expect(listReads(fetchMock).length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aksi untuk Aisyah" })).toHaveFocus());
  });

  it("shows the amount and status from the invite on the card", async () => {
    serveList(
      [leadRow({ parentPhone: "0812-3456-7890", programId: "prog-1", program: { name: "TK A" } })],
      {
        extra: invite(
          sent({
            formUrl: "https://talib.example/pendaftaran/tok-1",
            fee: { status: "UNPAID", amount: 300000, baseAmount: 300000, discountPercent: 0 },
          }),
        ),
      },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirim(user);
    const dialog = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(dialog).getByTestId("formulir-fee")).toHaveTextContent("Biaya formulir: Rp 300.000");
    expect(within(dialog).getByText("Belum bayar")).toBeInTheDocument();
  });

  it("names the address when the email went out", async () => {
    serveList(
      [leadRow({ parentEmail: "dewi@test.com", parentPhone: "0812-3456-7890", programId: "prog-1", program: { name: "TK A" } })],
      { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-1", emailed: true, hasEmail: true })) },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirim(user);
    expect(await screen.findByText("Email terkirim ke dewi@test.com")).toBeInTheDocument();
  });

  it("an error from the server still shows as a toast, with no card, and the list is read again", async () => {
    const fetchMock = serveList(
      [leadRow({ programId: "prog-1", program: { name: "TK A" } })],
      {
        extra: invite(
          reply({ error: "ALREADY_IN_PROGRESS", message: "Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang." }, 409),
        ),
      },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await clickKirim(user);
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang."),
    );
    expect(screen.queryByRole("dialog", { name: "Formulir siap dikirim" })).not.toBeInTheDocument();
    // The lead may have moved on since it was loaded.
    await waitFor(() => expect(listReads(fetchMock)).toHaveLength(2));
  });

  describe("resend (stage FORMULIR_DIKIRIM)", () => {
    const resendRow = (over: Record<string, unknown> = {}) =>
      leadRow({
        stage: "FORMULIR_DIKIRIM", payment: "UNPAID", programId: "prog-1", program: { name: "TK A" },
        // The formulir holds Day Care, a different program from the lead's own.
        application: formulir({ id: "ea-4", programId: "prog-2", dcareAddon: false, fee: { status: "UNPAID", amount: 150000, canRemind: true } }),
        ...over,
      });

    it("starts from what the formulir already holds, not from the lead", async () => {
      serveList([resendRow()], { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-2", created: false })) });
      const user = userEvent.setup();
      render(<AdmissionsPage />);
      const ask = await openKirim(user, "Kirim ulang tautan: Aisyah");
      await waitFor(() => expect(within(ask).getByTestId("kirim-formulir-fee")).toHaveTextContent("Rp 150.000"));
      expect(within(ask).getByRole("combobox", { name: /Program/ })).toHaveTextContent("Day Care");
      // Known choice, so the amount is a fact rather than an estimate.
      expect(within(ask).getByTestId("kirim-formulir-fee")).not.toHaveTextContent("Perkiraan");
    });

    it("sends only what staff changed: an untouched resend carries just the lead id", async () => {
      const fetchMock = serveList([resendRow()], { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-2", created: false })) });
      const user = userEvent.setup();
      render(<AdmissionsPage />);
      const ask = await openKirim(user, "Kirim ulang tautan: Aisyah");
      await waitFor(() => expect(within(ask).getByTestId("kirim-formulir-fee")).toHaveTextContent("Rp 150.000"));
      await user.click(within(ask).getByRole("button", { name: "Kirim formulir" }));
      await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/enrollments/invite"))!;
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ admissionId: "a1" });
    });
  });
});
