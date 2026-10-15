/**
 * Tinjau & Kirim shows the pendaftaran fee before the parent sends the form
 * (cycle 2026-10-10-pendaftaran-fee-payment), so the payment step after
 * submit is never a surprise. Display only: the server re-prices on submit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label }: { label: string }) => <div>{label}</div>,
}));

const REVIEW_STEP = 6;

const programs = [
  { id: "p-kb", code: "KB", name: "Kelompok Bermain", enrollmentFee: 300000 },
  { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: 375000 },
  { id: "p-free", code: "POPUP", name: "Pop Up", enrollmentFee: 0 },
];

const prefill = (programId: string, dcareAddon = false) => ({
  programId,
  dcareAddon,
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
});

function renderReview(programId: string, dcareAddon = false, list = programs) {
  render(<PendaftaranClient initialStep={REVIEW_STEP} token="tok" programs={list} prefill={prefill(programId, dcareAddon)} />);
}

describe("Tinjau: biaya pendaftaran", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("shows the program's fee as the total and says when it is paid", () => {
    renderReview("p-kb");
    const section = screen.getByRole("region", { name: "Biaya pendaftaran" });
    expect(section).toHaveTextContent("Kelompok Bermain");
    expect(section).toHaveTextContent("Rp 300.000");
    expect(section).toHaveTextContent("Total");
    expect(section).toHaveTextContent(/dibayar setelah formulir dikirim/i);
    expect(section).not.toHaveTextContent("Tambahan Day Care");
  });

  it("adds a Day Care line and totals both fees when the add-on is ticked", () => {
    renderReview("p-kb", true);
    const section = screen.getByRole("region", { name: "Biaya pendaftaran" });
    expect(section).toHaveTextContent("Tambahan Day Care");
    expect(section).toHaveTextContent("Rp 375.000");
    expect(section).toHaveTextContent("Rp 675.000");
  });

  it("does not double-charge when Day Care is itself the program", () => {
    renderReview("p-dc", true);
    const section = screen.getByRole("region", { name: "Biaya pendaftaran" });
    expect(section).toHaveTextContent("Rp 375.000");
    expect(section).not.toHaveTextContent("Tambahan Day Care");
    expect(section).not.toHaveTextContent("Rp 750.000");
  });

  it("shows no fee section for a free program", () => {
    renderReview("p-free");
    expect(screen.queryByRole("region", { name: "Biaya pendaftaran" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Biaya pendaftaran/)).not.toBeInTheDocument();
  });

  it("shows no fee section when the school has not priced anything (programs without fee fields)", () => {
    renderReview("p-1", false, [{ id: "p-1", name: "TK A" } as (typeof programs)[number]]);
    expect(screen.queryByRole("region", { name: "Biaya pendaftaran" })).not.toBeInTheDocument();
  });
});
