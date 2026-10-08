/**
 * R2-P-10: a single-parent / wali-only family can finish the public form.
 * R2-P-15: the bring-to-school checklist survives a reload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";
import { BringList } from "../bring-list";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label, saved }: { label: string; saved: boolean }) => (
    <div>{`${label}: ${saved ? "tersimpan" : "kosong"}`}</div>
  ),
}));

const programs = [{ id: "p-1", name: "TK A" }];

const student = {
  childName: "Aisyah",
  childGender: "P",
  birthPlace: "Bogor",
  dateOfBirth: "2021-01-01",
  agama: "ISLAM",
  kewarganegaraan: "WNI",
};

/** Ibu filled everything and signed; no ayah at all; flag saved in the draft. */
const onlyIbu = {
  programId: "p-1",
  dcareAddon: false,
  studentData: student,
  ayahData: {},
  ibuData: { name: "Siti" },
  consentData: { agreed: true, version: CONSENT_VERSION, onlyParent: "ibu", ayah: { name: "", signed: false }, ibu: { name: "Siti", signed: true } },
  documents: {},
};

const bothParents = {
  ...onlyIbu,
  ayahData: { name: "Budi" },
  consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
};

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

const lanjut = () => screen.getByRole("button", { name: "Lanjut" });
const toggle = () => screen.getByRole("checkbox", { name: /Hanya satu orang tua \/ wali yang mengisi/ });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => ok({})));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("single parent / wali: client validation", () => {
  it("both parents by default: a blank ibu name blocks Lanjut", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={2} token="tok" programs={programs} prefill={{ ...bothParents, ibuData: {} }} />);
    await user.click(lanjut());
    expect(screen.getByText("Nama ibu wajib diisi.")).toBeInTheDocument();
  });

  it("ticking the option on Data Ayah hides the ayah fields and lets Lanjut through without a name", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={{ ...bothParents, ayahData: {} }} />);
    await user.click(lanjut());
    expect(screen.getByText("Nama ayah wajib diisi.")).toBeInTheDocument();

    await user.click(toggle());
    expect(screen.queryByLabelText(/^Nama \*/)).not.toBeInTheDocument();
    expect(screen.queryByText("Nama ayah wajib diisi.")).not.toBeInTheDocument();

    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ibu" })).toBeInTheDocument();
  });

  it("the other parent's step explains the waiver, still requires a name and can undo it", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={2} token="tok" programs={programs} prefill={{ ...onlyIbu, ibuData: {} }} />);
    expect(screen.getByText(/data ayah dilewati/)).toBeInTheDocument();
    await user.click(lanjut());
    expect(screen.getByText("Nama ibu wajib diisi.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Isi data ayah juga" }));
    expect(screen.queryByText(/data ayah dilewati/)).not.toBeInTheDocument();
  });

  it("a bad phone typed for the waived parent does not block, and is not checked", async () => {
    const user = userEvent.setup();
    render(
      <PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={{ ...onlyIbu, ayahData: { phone: "abc" } }} />,
    );
    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ibu" })).toBeInTheDocument();
  });

  it("consent asks for only the filling parent's name and signature", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={onlyIbu} />);
    expect(screen.getByLabelText(/^Nama jelas Ibu/)).toBeInTheDocument();
    expect(screen.getByText("Tanda tangan Ibu: tersimpan")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Nama jelas Ayah/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tanda tangan Ayah/)).not.toBeInTheDocument();
    // No "waiting for the other parent" handover note either.
    expect(screen.queryByRole("region", { name: "Tanda tangan yang belum ada" })).not.toBeInTheDocument();
  });

  it("consent still blocks Lanjut when the filling parent has not signed", async () => {
    const user = userEvent.setup();
    const prefill = { ...onlyIbu, consentData: { ...onlyIbu.consentData, ibu: { name: "Siti", signed: false } } };
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={prefill} />);
    await user.click(lanjut());
    expect(screen.getByText("Tanda tangan ibu wajib disimpan.")).toBeInTheDocument();
    expect(screen.queryByText(/ayah wajib/i)).not.toBeInTheDocument();
  });

  it("without the flag the consent step still wants both signatures", async () => {
    const user = userEvent.setup();
    const prefill = { ...bothParents, consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "Budi", signed: false }, ibu: { name: "Siti", signed: true } } };
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={prefill} />);
    await user.click(lanjut());
    expect(screen.getByText("Tanda tangan ayah wajib disimpan.")).toBeInTheDocument();
  });
});

describe("single parent / wali: resume and persistence", () => {
  it("a saved single-parent draft resumes on Tinjau instead of Data Ayah", () => {
    render(<PendaftaranClient token="tok" programs={programs} prefill={onlyIbu} />);
    expect(screen.getByRole("heading", { name: "Tinjau & Kirim" })).toBeInTheDocument();
    expect(screen.queryByText("Ayah")).not.toBeInTheDocument();
    expect(screen.getByText("Siti")).toBeInTheDocument();
  });

  it("the same draft without the flag resumes on Data Ayah", () => {
    const prefill = { ...onlyIbu, consentData: { ...onlyIbu.consentData, onlyParent: undefined } };
    render(<PendaftaranClient token="tok" programs={programs} prefill={prefill} />);
    expect(screen.getByRole("heading", { name: "Data Ayah" })).toBeInTheDocument();
  });

  it("the checkbox shows the restored flag", () => {
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={onlyIbu} />);
    expect(toggle()).toBeChecked();
  });

  it("autosave carries the flag inside consentData; unticking drops it", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={{ ...bothParents, ayahData: {} }} />);

    await user.click(toggle());
    const patches = () =>
      vi.mocked(fetch).mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PATCH");
    await waitFor(() => expect(patches()).toHaveLength(1), { timeout: 4000 });
    expect(JSON.parse((patches()[0][1] as RequestInit).body as string).consentData.onlyParent).toBe("ibu");

    await user.click(toggle());
    await waitFor(() => expect(patches()).toHaveLength(2), { timeout: 4000 });
    expect(JSON.parse((patches()[1][1] as RequestInit).body as string).consentData).not.toHaveProperty("onlyParent");
  });

  it("submit sends the flag and no ayah requirement; success shows the thank-you card", async () => {
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
    render(<PendaftaranClient token="tok" programs={programs} prefill={onlyIbu} />);
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));

    expect(await screen.findByText(/Jazakumullah khairan/)).toBeInTheDocument();
    const submit = calls.find((c) => c.url.endsWith("/submit"))!;
    expect((submit.body as { consentData: { onlyParent: string } }).consentData.onlyParent).toBe("ibu");
  });
});

describe("success card after submit (R2-P-15)", () => {
  it("lists missing documents but not the waived parent's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/submit")
          ? Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true }) } as Response)
          : ok({}),
      ),
    );
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={onlyIbu} />);
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));

    expect(await screen.findByRole("heading", { name: "Berkas yang perlu dibawa ke sekolah" })).toBeInTheDocument();
    expect(screen.getByText("KTP Ibu")).toBeInTheDocument();
    expect(screen.queryByText("KTP Ayah")).not.toBeInTheDocument();
  });
});

describe("BringList (R2-P-15)", () => {
  it("lists the documents still to bring, with the same heading as the success card", () => {
    render(<BringList keys={["kk", "akta"]} />);
    expect(screen.getByRole("heading", { name: "Berkas yang perlu dibawa ke sekolah" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps one ul with every label as a listitem when rows are staggered in", () => {
    const { container } = render(<BringList keys={["kk", "akta", "ktp_ibu"]} />);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining(["KTP Ibu"]));
    expect(rows).toHaveLength(3);
  });

  it("renders nothing when everything is in", () => {
    const { container } = render(<BringList keys={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
