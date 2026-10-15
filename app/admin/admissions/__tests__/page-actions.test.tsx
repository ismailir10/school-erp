/**
 * What a Pendaftaran row offers, by stage: one visible primary action plus an overflow
 * menu, what Kirim Formulir does in one tap (and its result card), and the cancel
 * confirm. A lead stored with a retired status arrives as stage BARU and behaves as BARU.
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

describe("Kirim Formulir (one tap)", () => {
  const URL_1 = "https://talib.example/pendaftaran/tok-1";
  /** Answers the invite with `inviteReply` (a response, or a promise the test settles later). */
  const invite = (inviteReply: Response | Promise<Response>) => (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/enrollments/invite") && init?.method === "POST") return inviteReply as Response;
    return undefined;
  };
  const sent = (body: Record<string, unknown>) => reply({ id: "ea-1", ...body });
  const inviteCalls = (fetchMock: ReturnType<typeof serveList>) =>
    fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith("/api/enrollments/invite") && (init as RequestInit)?.method === "POST");

  async function tapKirim(user: User, name = "Kirim Formulir: Aisyah") {
    await user.click(await screen.findByRole("button", { name }));
  }

  it("posts the invite once and opens the result card: no question first, no program, no price", async () => {
    const fetchMock = serveList([leadRow({ programId: "prog-1", program: { name: "TK A" } })], {
      extra: invite(sent({ formUrl: URL_1 })),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);

    const card = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(card).getByLabelText("Tautan formulir")).toHaveValue(URL_1);
    expect(screen.queryByRole("dialog", { name: "Kirim formulir" })).not.toBeInTheDocument();

    const calls = inviteCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({ admissionId: "a1" });
    // No program list is read for a price any more.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/config/enrollment"))).toBe(false);
  });

  it("a double tap sends once; the button keeps its label, shows it is busy, and the progress is announced", async () => {
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((resolve) => { release = resolve; });
    const fetchMock = serveList([leadRow()], { extra: invite(gate) });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    const row = () => screen.getByRole("button", { name: "Kirim Formulir: Aisyah" });
    await user.dblClick(await screen.findByRole("button", { name: "Kirim Formulir: Aisyah" }));

    // Looked up again each time: the row's cell is rebuilt while the send is pending.
    await waitFor(() => expect(row()).toHaveAttribute("aria-disabled", "true"));
    // The visible label stays (label-in-name); the spinner is decoration only.
    expect(row()).toHaveTextContent("Kirim Formulir");
    expect(row()).toHaveAttribute("aria-busy", "true");
    expect(row().querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Mengirim formulir untuk Aisyah…").closest("[aria-live=polite]")).not.toBeNull();
    expect(inviteCalls(fetchMock)).toHaveLength(1);

    release(sent({ formUrl: URL_1 }));
    const card = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(inviteCalls(fetchMock)).toHaveLength(1);
    // The page behind the card is hidden from the accessibility tree: close it to read the row.
    await user.click(within(card).getByRole("button", { name: "Selesai" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(row()).not.toHaveAttribute("aria-disabled"));
    expect(row().querySelector("svg")).toBeNull();
    expect(screen.queryByText(/Mengirim formulir untuk/)).not.toBeInTheDocument();
  });

  it("tapping another row while one send is in flight sends that row too", async () => {
    let releaseA!: (r: Response) => void;
    const gateA = new Promise<Response>((resolve) => { releaseA = resolve; });
    const byLead = (replies: Record<string, Response | Promise<Response>>) => (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/enrollments/invite") && init?.method === "POST") {
        return replies[JSON.parse(init.body as string).admissionId] as Response;
      }
      return undefined;
    };
    const fetchMock = serveList(
      [leadRow({ id: "a1", childName: "Aisyah" }), leadRow({ id: "a2", childName: "Budi", parentName: "Sari" })],
      { extra: byLead({ a1: gateA, a2: sent({ id: "ea-2", formUrl: "https://talib.example/pendaftaran/tok-b" }) }) },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await user.click(await screen.findByRole("button", { name: "Kirim Formulir: Aisyah" }));
    await user.click(await screen.findByRole("button", { name: "Kirim Formulir: Budi" }));

    const card = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(card).getByLabelText("Tautan formulir")).toHaveValue("https://talib.example/pendaftaran/tok-b");
    const bodies = inviteCalls(fetchMock).map(([, init]) => JSON.parse((init as RequestInit).body as string).admissionId);
    expect(bodies).toEqual(["a1", "a2"]);

    releaseA(sent({ formUrl: URL_1 }));
    await waitFor(() => expect(inviteCalls(fetchMock)).toHaveLength(2));
  });

  it("a walk-in with only a phone gets the card: link, WhatsApp and fill-together, no email wording", async () => {
    serveList([leadRow({ parentPhone: "0812-3456-7890" })], {
      extra: invite(sent({ formUrl: URL_1, emailed: false, hasEmail: false })),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);

    const dialog = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(dialog).getByText("Tidak ada email — bagikan lewat WhatsApp")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tautan formulir")).toHaveValue(URL_1);
    expect(within(dialog).getByRole("link", { name: "Kirim lewat WhatsApp (tab baru)" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/6281234567890?text="),
    );
    expect(within(dialog).getByRole("link", { name: "Isi bersama orang tua (tab baru)" })).toHaveAttribute("href", URL_1);
    // A first send has no old link to warn about.
    expect(within(dialog).queryByText(/Tautan lama tidak berlaku lagi/)).not.toBeInTheDocument();
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("the result card has no fee block and no Tandai lunas / Bebaskan; it says the parent pays after the form", async () => {
    const fetchMock = serveList([leadRow({ parentPhone: "0812-3456-7890" })], { extra: invite(sent({ formUrl: URL_1 })) });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    const dialog = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });

    expect(within(dialog).queryByTestId("formulir-fee")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Biaya formulir/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Tandai lunas/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Bebaskan/ })).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("Biaya pendaftaran dibayar orang tua setelah mengisi dan mengirim formulir."),
    ).toBeInTheDocument();
    // The card never reads the formulir's fee permissions.
    expect(fetchMock.mock.calls.some(([u]) => /\/api\/enrollments\/ea-1$/.test(String(u)))).toBe(false);
  });

  it("reads the list again when the card closes, and returns focus to the row", async () => {
    const fetchMock = serveList([leadRow({ parentPhone: "0812-3456-7890" })], { extra: invite(sent({ formUrl: URL_1 })) });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    const card = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    await user.click(within(card).getByRole("button", { name: "Selesai" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Once after the send, once when the card closes.
    await waitFor(() => expect(listReads(fetchMock).length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aksi untuk Aisyah" })).toHaveFocus());
  });

  it("names the address when the email went out", async () => {
    serveList([leadRow({ parentEmail: "dewi@test.com", parentPhone: "0812-3456-7890" })], {
      extra: invite(sent({ formUrl: URL_1, emailed: true, hasEmail: true })),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    expect(await screen.findByText("Email terkirim ke dewi@test.com")).toBeInTheDocument();
  });

  it("a 409 shows the server's message as a toast, no card, and the list is read again", async () => {
    const fetchMock = serveList([leadRow()], {
      extra: invite(
        reply({ error: "ALREADY_IN_PROGRESS", message: "Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang." }, 409),
      ),
    });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang."),
    );
    expect(screen.queryByRole("dialog", { name: "Formulir siap dikirim" })).not.toBeInTheDocument();
    // The lead may have moved on since it was loaded.
    await waitFor(() => expect(listReads(fetchMock)).toHaveLength(2));
  });

  it("a 429 asks staff to wait, and the button works again afterwards", async () => {
    const fetchMock = serveList([leadRow()], { extra: invite(reply({ error: "rate_limited" }, 429)) });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Kirim Formulir: Aisyah" });
    expect(button).not.toHaveAttribute("aria-disabled");
    await user.click(button);
    await waitFor(() => expect(inviteCalls(fetchMock)).toHaveLength(2));
  });

  it("a server failure says so with a toast and leaves the row as it was", async () => {
    serveList([leadRow()], { extra: invite(reply({ error: "boom" }, 500)) });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terjadi kendala di server. Coba lagi sebentar lagi."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("an answer without a link is not shown as a card", async () => {
    serveList([leadRow()], { extra: invite(sent({})) });
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user);
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Formulir disiapkan, tetapi tautannya tidak terbaca. Muat ulang lalu coba lagi."),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a resend (Kirim ulang tautan) is also one tap with just the lead id", async () => {
    const fetchMock = serveList(
      [
        leadRow({
          stage: "FORMULIR_DIKIRIM", payment: "UNPAID", programId: "prog-1", program: { name: "TK A" },
          application: formulir({ id: "ea-4", fee: { status: "UNPAID", amount: 150000, canRemind: true } }),
        }),
      ],
      { extra: invite(sent({ formUrl: "https://talib.example/pendaftaran/tok-2" })) },
    );
    const user = userEvent.setup();
    render(<AdmissionsPage />);
    await tapKirim(user, "Kirim ulang tautan: Aisyah");
    const card = await screen.findByRole("dialog", { name: "Formulir siap dikirim" });
    expect(within(card).getByLabelText("Tautan formulir")).toHaveValue("https://talib.example/pendaftaran/tok-2");
    // A resend swaps the token: the card says the old link is dead.
    expect(
      within(card).getByText("Tautan lama tidak berlaku lagi; kirim tautan baru ini ke orang tua."),
    ).toBeInTheDocument();
    const calls = inviteCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({ admissionId: "a1" });
  });
});
