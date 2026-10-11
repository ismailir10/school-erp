/**
 * "Kirim formulir" question (pay-first): the lead's program is prefilled, Program is
 * required, the amount shown is the one the server will charge, and the server's
 * answers (field errors, 403, 409) land where the sender can act on them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KirimFormulirForm, type KirimFormulirFormProps } from "../kirim-formulir-form";
import type { Admission } from "../types";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const PROGRAMS = [
  { id: "prog-tk", code: "TK", name: "TK A", enrollmentFee: 300_000 },
  { id: "prog-dc", code: "DCARE", name: "Day Care", enrollmentFee: 150_000 },
  { id: "prog-free", code: "KB", name: "Kelompok Bermain", enrollmentFee: 0 },
];

const lead = (over: Partial<Admission> = {}): Admission => ({
  id: "adm-1",
  childName: "Aisyah",
  childAge: null,
  dateOfBirth: null,
  childGender: null,
  parentName: "Dewi Sartika",
  parentPhone: "0812-3456-7890",
  parentWhatsapp: null,
  parentEmail: null,
  parentEducation: null,
  parentOccupation: null,
  parentIncome: null,
  parentRelationship: null,
  programId: "prog-tk",
  campusPreference: null,
  source: "WALK_IN",
  status: "INQUIRY",
  notes: null,
  followUpDate: null,
  studentId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  program: { name: "TK A" },
  detectedParent: null,
  ...over,
});

type Reply = { ok: boolean; status: number; body: unknown };
const ok = (body: unknown): Reply => ({ ok: true, status: 200, body });
const fail = (status: number, body: unknown): Reply => ({ ok: false, status, body });

const fetchMock = vi.fn();

/** Config answers with `programs` (or fails); the invite answers with `invite`. */
function serve(opts: { programs?: unknown[] | "fail" | Promise<Reply>; invite?: Reply } = {}) {
  const { programs = PROGRAMS, invite = ok({ id: "app-1", formUrl: "https://talib.example/pendaftaran/tok-1", emailed: false, hasEmail: false, created: true, fee: null }) } = opts;
  fetchMock.mockImplementation(async (url: string) => {
    const reply: Reply =
      url === "/api/config/enrollment"
        ? programs === "fail"
          ? fail(500, {})
          : programs instanceof Promise
            ? await programs
            : ok({ programs })
        : invite;
    return { ok: reply.ok, status: reply.status, json: async () => reply.body } as Response;
  });
}

const inviteCall = () => fetchMock.mock.calls.find(([u]) => u === "/api/enrollments/invite");
const inviteBody = () => JSON.parse((inviteCall()![1] as RequestInit).body as string);

function setup(over: Partial<KirimFormulirFormProps> = {}) {
  const onClose = vi.fn();
  const onSent = vi.fn();
  const onStale = vi.fn();
  render(<KirimFormulirForm admission={lead()} onClose={onClose} onSent={onSent} onStale={onStale} {...over} />);
  return { onClose, onSent, onStale, user: userEvent.setup() };
}

const dialog = () => screen.getByRole("dialog", { name: "Kirim formulir" });
const feeText = () => screen.getByTestId("kirim-formulir-fee").textContent;
const send = () => screen.getByRole("button", { name: "Kirim formulir" });
async function ready() {
  // The list has arrived once the prefilled program shows.
  await waitFor(() => expect(feeText()).not.toContain("Memuat"));
}

beforeEach(() => {
  fetchMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("KirimFormulirForm", () => {
  it("renders nothing while there is no lead, and asks for nothing yet", () => {
    serve();
    setup({ admission: null });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("Program and the amount", () => {
    it("prefills the lead's program and shows its price", async () => {
      serve();
      setup();
      await ready();
      expect(within(dialog()).getByRole("combobox", { name: /Program/ })).toHaveTextContent("TK A");
      expect(feeText()).toBe("Biaya formulir: Rp 300.000");
    });

    it("says it is loading, and does not offer Kirim, until the prices are here", async () => {
      let release!: (r: Reply) => void;
      serve({ programs: new Promise<Reply>((resolve) => (release = resolve)) });
      setup();
      expect(feeText()).toBe("Memuat biaya…");
      expect(send()).toBeDisabled();
      release(ok({ programs: PROGRAMS }));
      await waitFor(() => expect(feeText()).toBe("Biaya formulir: Rp 300.000"));
      expect(send()).toBeEnabled();
    });

    it("says Tanpa biaya only for a loaded program that is free", async () => {
      serve();
      setup({ admission: lead({ programId: "prog-free", program: { name: "Kelompok Bermain" } }) });
      await waitFor(() => expect(feeText()).toBe("Biaya formulir: Tanpa biaya"));
    });

    it("never claims it is free when the price list could not be loaded", async () => {
      serve({ programs: "fail" });
      setup();
      expect(await screen.findByRole("alert")).toHaveTextContent(/Daftar program belum bisa dimuat/);
      expect(feeText()).not.toContain("Tanpa biaya");
      expect(feeText()).not.toContain("Rp");
      // The lead's own program can still be sent.
      expect(send()).toBeEnabled();
    });

    it("asks for a program when the lead has none, instead of showing a price", async () => {
      serve();
      setup({ admission: lead({ programId: null, program: null }) });
      await waitFor(() => expect(feeText()).toBe("Pilih program untuk melihat biaya."));
    });

    it("does not offer or prefill a program that has been retired", async () => {
      serve({ programs: PROGRAMS.slice(1) });
      setup();
      await waitFor(() => expect(feeText()).toBe("Pilih program untuk melihat biaya."));
      expect(within(dialog()).getByRole("combobox", { name: /Program/ })).not.toHaveTextContent("TK A");
    });

    it("adds the Day Care price when the add-on is ticked", async () => {
      serve();
      const { user } = setup();
      await ready();
      await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
      expect(feeText()).toContain("Biaya formulir: Rp 450.000");
      expect(feeText()).toContain("Program Rp 300.000 + Day Care Rp 150.000");
      await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
      expect(feeText()).toBe("Biaya formulir: Rp 300.000");
    });

    it("re-prices when another program is picked", async () => {
      serve();
      const { user } = setup();
      await ready();
      await user.click(within(dialog()).getByRole("combobox", { name: /Program/ }));
      await user.click(await screen.findByRole("option", { name: "Kelompok Bermain" }));
      expect(feeText()).toBe("Biaya formulir: Tanpa biaya");
    });
  });

  describe("who it goes to", () => {
    it("names the email when the lead has one", async () => {
      serve();
      setup({ admission: lead({ parentEmail: "dewi@test.com" }) });
      expect(screen.getByText("Dikirim ke dewi@test.com")).toBeTruthy();
    });

    it("says how to share the link when there is no email", async () => {
      serve();
      setup();
      expect(screen.getByText("Tidak ada email — bagikan lewat WhatsApp atau isi bersama orang tua")).toBeTruthy();
    });
  });

  describe("sending", () => {
    it("posts only what staff changed, then hands the response to the page", async () => {
      serve({
        invite: ok({
          id: "app-9",
          formUrl: "https://talib.example/pendaftaran/tok-9",
          emailed: true,
          hasEmail: true,
          created: false,
          fee: { status: "UNPAID", amount: 450_000 },
          feeNote: "repriced",
        }),
      });
      const { user, onSent } = setup({ admission: lead({ parentEmail: "dewi@test.com" }) });
      await ready();
      await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
      await user.click(send());

      await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
      expect(inviteBody()).toEqual({ admissionId: "adm-1", dcareAddon: true });
      const [sentLead, result] = onSent.mock.calls[0];
      expect(sentLead.id).toBe("adm-1");
      expect(result).toEqual({
        id: "app-9",
        formUrl: "https://talib.example/pendaftaran/tok-9",
        emailed: true,
        hasEmail: true,
        created: false,
        fee: { status: "UNPAID", amount: 450_000 },
        feeNote: "repriced",
      });
    });

    it("an untouched form sends only the lead: the server keeps the program and Day Care it already holds", async () => {
      serve();
      const { user, onSent } = setup();
      await ready();
      await user.click(send());
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      expect(inviteBody()).toEqual({ admissionId: "adm-1" });
    });

    it("a changed program sends only the program", async () => {
      serve();
      const { user, onSent } = setup();
      await ready();
      await user.click(within(dialog()).getByRole("combobox", { name: /Program/ }));
      await user.click(await screen.findByRole("option", { name: "Kelompok Bermain" }));
      await user.click(send());
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      expect(inviteBody()).toEqual({ admissionId: "adm-1", programId: "prog-free" });
    });

    it("a lead with no program must pick one, and it is sent", async () => {
      serve();
      const { user, onSent } = setup({ admission: lead({ programId: null, program: null }) });
      await ready();
      await user.click(within(dialog()).getByRole("combobox", { name: /Program/ }));
      await user.click(await screen.findByRole("option", { name: "TK A" }));
      await user.click(send());
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      expect(inviteBody()).toEqual({ admissionId: "adm-1", programId: "prog-tk" });
    });

    it("passes the response's created flag through, which is how the card tells free from older", async () => {
      serve({ invite: ok({ id: "app-1", formUrl: "https://talib.example/pendaftaran/tok-1", created: true, fee: null }) });
      const { user, onSent } = setup();
      await ready();
      await user.click(send());
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      expect(onSent.mock.calls[0][1]).toMatchObject({ fee: null, created: true });
    });

    it("posts once when submitted twice in the same tick (a double click)", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      serve();
      const base = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "/api/enrollments/invite") await gate;
        return base(url, init);
      });
      const { onSent } = setup();
      await ready();
      // Two submits in the same tick, before React has re-rendered the button as busy.
      const formEl = dialog().querySelector("form")!;
      await act(async () => {
        fireEvent.submit(formEl);
        fireEvent.submit(formEl);
      });
      release();
      await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls.filter(([u]) => u === "/api/enrollments/invite")).toHaveLength(1);
    });

    it("sends the lead's program when the price list failed and nothing was touched", async () => {
      serve({ programs: "fail" });
      const { user, onSent } = setup();
      await waitFor(() => expect(screen.getByText(/Daftar program belum bisa dimuat/)).toBeTruthy());
      await user.click(send());
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      expect(inviteBody()).toEqual({ admissionId: "adm-1" });
    });

    it("needs a program: says so, and sends nothing", async () => {
      serve();
      const { user, onSent } = setup({ admission: lead({ programId: null, program: null }) });
      await ready();
      await user.click(send());
      expect(await screen.findByText("Pilih program dulu.")).toBeTruthy();
      expect(inviteCall()).toBeUndefined();
      expect(onSent).not.toHaveBeenCalled();
    });

    it("puts a server field error on the Program select", async () => {
      serve({
        invite: fail(400, {
          error: "Validasi gagal",
          errors: [{ field: "programId", message: "Program ini sudah tidak aktif. Pilih program lain." }],
        }),
      });
      const { user, onSent } = setup();
      await ready();
      await user.click(send());
      const message = await screen.findByText("Program ini sudah tidak aktif. Pilih program lain.");
      expect(message).toBeTruthy();
      expect(within(dialog()).getByRole("combobox", { name: /Program/ })).toHaveAttribute("aria-invalid", "true");
      expect(onSent).not.toHaveBeenCalled();
    });

    it("shows the server's message when repricing needs the finance key", async () => {
      const message = "Mengubah program mengubah biaya pendaftaran; butuh izin keuangan.";
      serve({ invite: fail(403, { error: message }) });
      const { user, onSent, onClose } = setup();
      await ready();
      await user.click(send());
      expect(await within(dialog()).findByText(message)).toBeTruthy();
      expect(toast.error).toHaveBeenCalledWith(message);
      expect(onSent).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it.each([
      ["LEAD_CLOSED", "Pendaftaran ini sudah dibatalkan — formulir tidak bisa dikirim."],
      ["ALREADY_IN_PROGRESS", "Formulir sudah diisi atau sedang diproses — tidak bisa dikirim ulang."],
    ])("%s toasts the server's message, closes, and asks the list to refresh", async (error, message) => {
      serve({ invite: fail(409, { error, message }) });
      const { user, onSent, onClose, onStale } = setup();
      await ready();
      await user.click(send());
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onSent).not.toHaveBeenCalled();
    });

    it("says to slow down on a rate limit instead of showing the machine word", async () => {
      serve({ invite: fail(429, { error: "rate_limited" }) });
      const { user } = setup();
      await ready();
      await user.click(send());
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi."));
    });

    it("does not open a card when the response has no link", async () => {
      serve({ invite: ok({ emailed: false, hasEmail: false }) });
      const { user, onSent, onClose } = setup();
      await ready();
      await user.click(send());
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Formulir disiapkan, tetapi tautannya tidak terbaca. Muat ulang lalu coba lagi."),
      );
      expect(onSent).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it("Batal closes without sending", async () => {
      serve();
      const { user, onClose } = setup();
      await ready();
      await user.click(screen.getByRole("button", { name: "Batal" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(inviteCall()).toBeUndefined();
    });
  });

  it("does not ask for Day Care when the program is Day Care itself, and sends no add-on for it", async () => {
    serve();
    const { user, onSent } = setup();
    await ready();
    await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
    await user.click(within(dialog()).getByRole("combobox", { name: /Program/ }));
    await user.click(await screen.findByRole("option", { name: "Day Care" }));
    expect(screen.queryByRole("checkbox", { name: "Tambahan Day Care (penitipan)" })).toBeNull();
    expect(feeText()).toBe("Biaya formulir: Rp 150.000");
    await user.click(send());
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(inviteBody()).toEqual({ admissionId: "adm-1", programId: "prog-dc" });
  });

  describe("a resend", () => {
    it("calls the amount an estimate while nothing is changed and the formulir's own choice is unknown", async () => {
      serve();
      const { user } = setup({ resend: true });
      await ready();
      expect(feeText()).toContain("Perkiraan biaya: Rp 300.000");
      expect(feeText()).toContain("Perkiraan; nominal mengikuti formulir yang sudah dikirim.");
      // Touching a field makes it the choice that is sent, so the amount is the real one again.
      await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
      expect(feeText()).toContain("Biaya formulir: Rp 450.000");
      expect(feeText()).not.toContain("Perkiraan");
    });

    it("states the amount plainly when the caller knows what the formulir holds", async () => {
      serve();
      setup({ resend: true, current: { programId: "prog-tk", dcareAddon: false } });
      await ready();
      expect(feeText()).toBe("Biaya formulir: Rp 300.000");
    });
  });

  it("starts from what the formulir already holds when the caller knows it (a resend)", async () => {
    serve();
    setup({ admission: lead({ programId: null, program: null }), current: { programId: "prog-dc", dcareAddon: false } });
    await waitFor(() => expect(feeText()).toBe("Biaya formulir: Rp 150.000"));
    expect(within(dialog()).getByRole("combobox", { name: /Program/ })).toHaveTextContent("Day Care");
  });

  it("a free program with the Day Care add-on is priced at the add-on alone, without a 'Program Rp 0' line", async () => {
    serve();
    const { user } = setup({ admission: lead({ programId: "prog-free", program: { name: "Kelompok Bermain" } }) });
    await waitFor(() => expect(feeText()).toBe("Biaya formulir: Tanpa biaya"));
    await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
    expect(feeText()).toBe("Biaya formulir: Rp 150.000");
  });
});
