/**
 * Submitting the form: the thank-you card carries the pendaftaran fee the
 * server priced, so the parent goes straight on to pay
 * (cycle 2026-10-10-pendaftaran-fee-payment).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label }: { label: string }) => <div>{label}</div>,
}));

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

const programs = [{ id: "p-1", name: "TK A", code: "TKIT", enrollmentFee: 300_000 }];

const signed = {
  programId: "p-1",
  dcareAddon: false,
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
  consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
  documents: {},
};

function reply(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  } as Response);
}

/** Fill the form, submit from Tinjau, with `submit` deciding what the server answers. */
async function submitWith(submit: () => Promise<Response>) {
  vi.mocked(fetch).mockImplementation((input) => (String(input).endsWith("/submit") ? submit() : reply(200, {})));
  const user = userEvent.setup();
  render(<PendaftaranClient initialStep={0} token="tok-1" programs={programs} prefill={signed} />);
  for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Lanjut" }));
  await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
  return user;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => reply(200, {})));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("submit → payment", () => {
  it("thanks the parent, then puts the pendaftaran fee front and centre", async () => {
    await submitWith(() => reply(201, { ok: true, id: "app-1", fee: { baseAmount: 300_000, amount: 300_000, status: "UNPAID" } }));

    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    expect(screen.getByText(/sudah kami terima/)).toBeInTheDocument();
    expect(screen.getByText("Langkah terakhir")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bayar biaya pendaftaran" })).toBeInTheDocument();
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("the pay button asks for a link for THIS form's token", async () => {
    const user = await submitWith(() =>
      reply(201, { ok: true, id: "app-1", fee: { baseAmount: 300_000, amount: 300_000, status: "UNPAID" } }),
    );
    await screen.findByRole("button", { name: "Bayar sekarang" });
    vi.mocked(fetch).mockImplementation(() => reply(502, { error: "LINK_FAILED" }));
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === "/api/enrollments/token/tok-1/pay")).toBe(true));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tautan pembayaran belum bisa dibuat");
  });

  it("a free program shows the plain thank-you, with no payment step", async () => {
    await submitWith(() => reply(201, { ok: true, id: "app-1", fee: null }));
    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    expect(screen.queryByText("Langkah terakhir")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bayar/ })).not.toBeInTheDocument();
  });

  it("an older server that answers without a fee still thanks the parent", async () => {
    await submitWith(() => reply(201, { ok: true, id: "app-1" }));
    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bayar/ })).not.toBeInTheDocument();
  });

  it("a body that is not JSON never turns a successful submit into an error", async () => {
    await submitWith(() => reply(201, undefined));
    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    expect(screen.queryByText(/Gagal mengirim formulir/)).not.toBeInTheDocument();
  });

  it("a nonsense amount is ignored rather than shown", async () => {
    await submitWith(() => reply(201, { ok: true, id: "a", fee: { baseAmount: "abc", amount: "abc", status: "UNPAID" } }));
    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    expect(screen.queryByText("Langkah terakhir")).not.toBeInTheDocument();
  });
});
