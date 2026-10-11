/**
 * The form under pay-first (cycle 2026-10-11-pendaftaran-simplify): a refused write
 * (409 PAYMENT_REQUIRED) sends the parent to pay and keeps their edits, it is not
 * mistaken for "already submitted"; program and Day Care are read-only once the fee
 * exists; Tinjau and the thank-you card show no price when the fee is settled.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label, onSave }: { label: string; onSave: (b: Blob) => void }) => (
    <button type="button" onClick={() => onSave(new Blob(["x"], { type: "image/png" }))}>
      {`Simpan ${label}`}
    </button>
  ),
}));

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

const PAY_URL = "/pendaftaran/tok-1/pembayaran";
const programs = [{ id: "p-1", name: "TK A", code: "TKIT", enrollmentFee: 300_000 }];

const prefill = {
  programId: "p-1",
  dcareAddon: true,
  studentData: {
    childName: "Aisyah",
    childGender: "P",
    birthPlace: "Bogor",
    dateOfBirth: "2021-01-01",
    agama: "ISLAM",
    kewarganegaraan: "WNI",
  },
  ayahData: { name: "Budi" },
  ibuData: { name: "Siti" },
  consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: false } },
  documents: {},
};
const locked = { programName: "TK A", dcareAddon: true, feeStatus: "PAID" as const };

function reply(status: number, body?: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as Response);
}
const PAYMENT_REQUIRED = () => reply(409, { error: "PAYMENT_REQUIRED", message: "Bayar biaya formulir dulu supaya formulir bisa diisi." });
const ALREADY_SUBMITTED = () => reply(409, { error: "ALREADY_SUBMITTED" });

const navigate = vi.fn();

/** Answers `route` (a URL suffix) with `answer`; everything else with 200. */
function serve(route: string, answer: () => Promise<Response>, method?: string) {
  vi.mocked(fetch).mockImplementation((input, init) =>
    String(input).endsWith(route) && (!method || (init as RequestInit)?.method === method) ? answer() : reply(200, {}),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => reply(200, {})));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

function renderForm(props: Partial<React.ComponentProps<typeof PendaftaranClient>> = {}) {
  return render(
    <PendaftaranClient initialStep={0} token="tok-1" programs={programs} prefill={prefill} navigate={navigate} {...props} />,
  );
}

async function typeName(user: ReturnType<typeof userEvent.setup>, value: string) {
  const name = screen.getByLabelText(/^Nama lengkap/);
  await user.clear(name);
  await user.type(name, value);
}

describe("a refused write (409 PAYMENT_REQUIRED)", () => {
  it("autosave: goes to the payment screen, once", async () => {
    serve("/tok-1", PAYMENT_REQUIRED, "PATCH");
    const user = userEvent.setup();
    renderForm();
    await typeName(user, "Zahra");
    fireEvent(window, new Event("pagehide"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(PAY_URL));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("autosave: 'already submitted' is not a payment problem", async () => {
    serve("/tok-1", ALREADY_SUBMITTED, "PATCH");
    const user = userEvent.setup();
    renderForm();
    await typeName(user, "Zahra");
    fireEvent(window, new Event("pagehide"));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, i]) => (i as RequestInit)?.method === "PATCH")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(navigate).not.toHaveBeenCalled();
  });

  async function submitFrom() {
    const user = userEvent.setup();
    renderForm({ prefill: { ...prefill, consentData: { ...prefill.consentData, ibu: { name: "Siti", signed: true } } } });
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
  }

  it("submit: sends the parent to pay and does not say 'sudah diterima'", async () => {
    serve("/submit", PAYMENT_REQUIRED);
    await submitFrom();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(PAY_URL));
    expect(screen.queryByText(/sudah diterima sebelumnya/)).not.toBeInTheDocument();
  });

  it("submit: 'already submitted' keeps today's message and does not navigate", async () => {
    serve("/submit", ALREADY_SUBMITTED);
    await submitFrom();

    expect(await screen.findByText("Formulir ini sudah diterima sebelumnya.")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a 409 with an unreadable body stays 'already submitted'", async () => {
    serve("/submit", () => reply(409));
    await submitFrom();
    expect(await screen.findByText("Formulir ini sudah diterima sebelumnya.")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("signature: goes to pay instead of 'Gagal menyimpan tanda tangan'", async () => {
    serve("/signature?which=ibu", PAYMENT_REQUIRED, "POST");
    const user = userEvent.setup();
    renderForm();
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    await user.click(screen.getByRole("button", { name: /Simpan .*Ibu/ }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(PAY_URL));
    expect(screen.queryByText(/Gagal menyimpan tanda tangan/)).not.toBeInTheDocument();
  });
});

describe("Program step once the fee exists", () => {
  async function toProgram(user: ReturnType<typeof userEvent.setup>, props: Partial<React.ComponentProps<typeof PendaftaranClient>> = {}) {
    renderForm({ lockedProgram: locked, ...props });
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
  }

  it("shows program and Day Care as text, with nothing to choose", async () => {
    await toProgram(userEvent.setup());
    expect(screen.getByRole("heading", { name: "Pilihan Program" })).toBeInTheDocument();
    expect(screen.getByText("TK A")).toBeInTheDocument();
    expect(screen.getByText("Ya")).toBeInTheDocument();
    expect(screen.getByText("Dipilih saat formulir dikirim.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("Lanjut is not blocked even when the stored program is unknown to this tab", async () => {
    const user = userEvent.setup();
    await toProgram(user, { prefill: { ...prefill, programId: null }, lockedProgram: { ...locked, programName: null } });
    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.queryByText("Program wajib dipilih.")).not.toBeInTheDocument();
    expect(screen.getByText("Berkas pendukung")).toBeInTheDocument();
  });

  it("autosave and submit send no program or Day Care", async () => {
    vi.mocked(fetch).mockImplementation((input) =>
      String(input).endsWith("/submit") ? reply(201, { ok: true, id: "a", fee: null, feeStatus: "PAID" }) : reply(200, {}),
    );
    const user = userEvent.setup();
    renderForm({
      lockedProgram: locked,
      prefill: { ...prefill, consentData: { ...prefill.consentData, ibu: { name: "Siti", signed: true } } },
    });
    await typeName(user, "Zahra");
    fireEvent(window, new Event("pagehide"));
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
    await screen.findByText(/Jazakumullah khairan/);

    const bodies = vi.mocked(fetch).mock.calls
      .filter(([, i]) => (i as RequestInit)?.method === "PATCH")
      .map(([, i]) => JSON.parse((i as RequestInit).body as string));
    expect(bodies.length).toBeGreaterThan(0);
    const submit = vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith("/submit"))!;
    for (const body of [...bodies, JSON.parse((submit[1] as RequestInit).body as string)]) {
      expect(body).not.toHaveProperty("programId");
      expect(body).not.toHaveProperty("dcareAddon");
    }
  });

  it("a formulir without a fee row keeps the editable Program step", async () => {
    const user = userEvent.setup();
    renderForm();
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});

describe("Tinjau with a settled fee", () => {
  it("says 'Lunas' and shows no price", () => {
    renderForm({ initialStep: 6, lockedProgram: locked });
    const section = screen.getByRole("region", { name: "Biaya pendaftaran" });
    expect(section).toHaveTextContent("Biaya formulir");
    expect(section).toHaveTextContent("Lunas");
    expect(section).not.toHaveTextContent("Rp");
    expect(section).not.toHaveTextContent(/dibayar setelah formulir dikirim/i);
    expect(screen.getByText("TK A")).toBeInTheDocument();
  });

  it("says 'Dibebaskan' for a waived fee", () => {
    renderForm({ initialStep: 6, lockedProgram: { ...locked, feeStatus: "WAIVED" } });
    expect(screen.getByRole("region", { name: "Biaya pendaftaran" })).toHaveTextContent("Dibebaskan");
  });

  it("a formulir without a fee row still shows the price to pay after sending", () => {
    renderForm({ initialStep: 6 });
    const section = screen.getByRole("region", { name: "Biaya pendaftaran" });
    expect(section).toHaveTextContent("Rp 300.000");
    expect(section).toHaveTextContent(/dibayar setelah formulir dikirim/i);
  });
});

describe("thank-you card", () => {
  async function submitWith(answer: () => Promise<Response>, props: Partial<React.ComponentProps<typeof PendaftaranClient>> = {}) {
    serve("/submit", answer);
    const user = userEvent.setup();
    renderForm({ prefill: { ...prefill, consentData: { ...prefill.consentData, ibu: { name: "Siti", signed: true } } }, ...props });
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
    await screen.findByText(/Jazakumullah khairan/);
  }

  it.each(["PAID", "WAIVED"])("has no payment step when the fee was %s before the form", async (feeStatus) => {
    await submitWith(() => reply(201, { ok: true, id: "a", fee: null, feeStatus }), { lockedProgram: locked });
    expect(screen.getByText(/sudah kami terima/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bayar|Lanjutkan pembayaran/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Langkah terakhir")).not.toBeInTheDocument();
  });

  it("does not show a payment step even if a fee comes back with a settled status", async () => {
    await submitWith(() => reply(201, { ok: true, id: "a", fee: { baseAmount: 300_000, amount: 300_000, status: "UNPAID" }, feeStatus: "PAID" }), {
      lockedProgram: locked,
    });
    expect(screen.queryByRole("button", { name: "Bayar sekarang" })).not.toBeInTheDocument();
  });

  it("a formulir from before pay-first still ends with the payment step", async () => {
    await submitWith(() => reply(201, { ok: true, id: "a", fee: { baseAmount: 300_000, amount: 300_000, status: "UNPAID" } }));
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
    expect(screen.getByText("Langkah terakhir")).toBeInTheDocument();
  });
});
