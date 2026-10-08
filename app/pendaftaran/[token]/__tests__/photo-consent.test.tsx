/**
 * Clause 17 (photo/video) on the consent letter, and the v1 -> v2 version bump:
 * a draft ticked on the old letter must be ticked again, names and signatures stay.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";
import {
  CONSENT_CLAUSES,
  CONSENT_VERSION,
  PHOTO_CLAUSE_TITLE,
} from "@/lib/enrollment/consent-clauses";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label, saved }: { label: string; saved: boolean }) => (
    <div>{`${label}: ${saved ? "tersimpan" : "kosong"}`}</div>
  ),
}));

const programs = [{ id: "p-1", name: "TK A" }];

const base = {
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
  documents: {},
};

const signedBoth = { ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } };
const current = { ...base, consentData: { agreed: true, version: CONSENT_VERSION, ...signedBoth } };
const v1Draft = { ...base, consentData: { agreed: true, version: "annisaa-2026-v1", ...signedBoth } };

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

const agreeBox = () => screen.getByRole("checkbox", { name: /Kami sudah membaca, memahami, dan menyetujui/ });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => ok({})));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("photo/video clause on the consent step", () => {
  it("renders as the 17th list item with its heading and the wali kelas path", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={current} />);

    const list = screen.getByRole("heading", { name: "Surat Persetujuan Orang Tua" }).parentElement!.querySelector("ol")!;
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(17);

    const photo = items[16];
    expect(photo).toBe(screen.getByTestId("photo-consent-clause"));
    expect(photo).toHaveAttribute("data-photo-clause");
    expect(within(photo).getByText(PHOTO_CLAUSE_TITLE).tagName).toBe("STRONG");
    expect(photo).toHaveTextContent("Wali Kelas");
    expect(photo).toHaveTextContent(CONSENT_CLAUSES[16]);
    // The other 16 stay plain.
    expect(items.filter((li) => li.hasAttribute("data-photo-clause"))).toHaveLength(1);
  });

  it("adds no checkbox: the one agreement box still gates Lanjut", async () => {
    const user = userEvent.setup();
    render(
      <PendaftaranClient
        initialStep={5}
        token="tok"
        programs={programs}
        prefill={{ ...base, consentData: { agreed: false, version: CONSENT_VERSION, ...signedBoth } }}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(screen.getByText("Persetujuan orang tua wajib dicentang.")).toBeInTheDocument();

    await user.click(agreeBox());
    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    expect(await screen.findByText("Tinjau & Kirim")).toBeInTheDocument();
  });
});

describe("consent version reset", () => {
  it("a v1 draft reopens with the box unticked but names and signatures intact", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={v1Draft} />);

    expect(agreeBox()).not.toBeChecked();
    expect(screen.getByLabelText(/^Nama jelas Ayah/)).toHaveValue("Budi");
    expect(screen.getByLabelText(/^Nama jelas Ibu/)).toHaveValue("Siti");
    expect(screen.getByText("Tanda tangan Ayah: tersimpan")).toBeInTheDocument();
    expect(screen.getByText("Tanda tangan Ibu: tersimpan")).toBeInTheDocument();
  });

  it("a draft with no version at all is treated as stale too", () => {
    const { version: _omit, ...noVersion } = current.consentData;
    void _omit;
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={{ ...current, consentData: noVersion }} />);
    expect(agreeBox()).not.toBeChecked();
  });

  it("a current-version draft keeps its tick", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={current} />);
    expect(agreeBox()).toBeChecked();
  });

  it("a complete v1 draft resumes on the consent step, not on Tinjau", () => {
    render(<PendaftaranClient token="tok" programs={programs} prefill={v1Draft} />);
    expect(screen.getByRole("heading", { name: "Surat Persetujuan Orang Tua" })).toBeInTheDocument();
    expect(agreeBox()).not.toBeChecked();
  });

  it("re-ticking on the new letter lets a v1 draft submit with version v2", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), body: init?.body ? JSON.parse(init.body as string) : null });
        return String(input).endsWith("/submit")
          ? Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true }) } as Response)
          : ok({});
      }),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={v1Draft} />);

    await user.click(agreeBox());
    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    await user.click(await screen.findByRole("button", { name: "Kirim Formulir" }));

    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    const submit = calls.find((c) => c.url.endsWith("/submit"))!;
    const consent = (submit.body as { consentData: { agreed: boolean; version: string } }).consentData;
    expect(consent.version).toBe("annisaa-2026-v2");
    expect(consent.agreed).toBe(true);
  });
});
