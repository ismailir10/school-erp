/**
 * Public enrollment form: the address block as the parent meets it. Kode pos
 * lookup and its edge cases live in `components/enrollment/__tests__/address-fields.test.tsx`;
 * this covers how the form uses it: hydration, autosave and submit shape,
 * Lanjut on a malformed kode pos, and the Tinjau rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";
import { submitEnrollmentSchema } from "@/lib/enrollment/submit-validation";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label }: { label: string }) => <div>{label}</div>,
}));

const programs = [{ id: "p-1", name: "TK A" }];

const CITARUM = { kodePos: "40115", kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat" };

const FULL = {
  perumahan: "Jl. Citarum 5", blokCluster: "B", rtRw: "01/02", kodePos: "40115",
  kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat",
};
const FULL_TEXT = "Jl. Citarum 5, B, 01/02, Citarum, Bandung Wetan, Kota Bandung, Jawa Barat, 40115";

const base = {
  programId: "p-1",
  dcareAddon: false,
  studentData: {
    childName: "Aisyah", childGender: "P", birthPlace: "Bogor", dateOfBirth: "2021-01-01", agama: "ISLAM", kewarganegaraan: "WNI",
  },
  ayahData: { name: "Budi" },
  ibuData: { name: "Siti" },
  consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "Budi", signed: true }, ibu: { name: "Siti", signed: true } },
  documents: {},
};
const withAddress = (student: object, ayah: object = {}, ibu: object = {}) => ({
  ...base,
  studentData: { ...base.studentData, ...student },
  ayahData: { ...base.ayahData, ...ayah },
  ibuData: { ...base.ibuData, ...ibu },
});

function reply(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

const patchBodies = () =>
  vi.mocked(fetch).mock.calls
    .filter(([, init]) => (init as RequestInit)?.method === "PATCH")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

const lanjut = () => screen.getByRole("button", { name: "Lanjut" });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/wilayah?kodepos=40115")) return reply({ results: [CITARUM] });
      if (url.includes("/wilayah")) return reply({ results: [] });
      return reply({});
    }),
  );
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("address block: layout and hydration", () => {
  it("Data Anak keeps its Alamat heading and a named address group, with all eight boxes", () => {
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={base} />);
    expect(screen.getByRole("heading", { name: "Alamat" })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Alamat anak" });
    for (const label of ["Perumahan / Jalan", "Blok / Cluster", "RT / RW", "Kode pos", "Kelurahan / Desa", "Kecamatan", "Kota / Kabupaten", "Provinsi"]) {
      expect(within(group).getByLabelText(label)).toBeInTheDocument();
    }
    // One column on a phone: the two-column grid only starts at the sm breakpoint.
    expect(group.className).toContain("sm:grid-cols-2");
    expect(group.className).not.toMatch(/(^|\s)grid-cols-/);
  });

  it("each parent step has its own Alamat heading and group", () => {
    const { unmount } = render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={base} />);
    expect(screen.getByRole("heading", { name: "Alamat" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Alamat Ayah" })).toBeInTheDocument();
    unmount();
    render(<PendaftaranClient initialStep={2} token="tok" programs={programs} prefill={base} />);
    expect(screen.getByRole("group", { name: "Alamat Ibu" })).toBeInTheDocument();
  });

  it("a reloaded draft with the new keys fills every box, for the child and both parents", () => {
    const prefill = withAddress({ address: FULL }, { address: { ...FULL, kodePos: "40116" } }, { address: { ...FULL, perumahan: "Jl. Ibu" } });
    const { unmount } = render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={prefill} />);
    for (const [label, value] of Object.entries({
      "Perumahan / Jalan": "Jl. Citarum 5", "Blok / Cluster": "B", "RT / RW": "01/02", "Kode pos": "40115",
      "Kelurahan / Desa": "Citarum", Kecamatan: "Bandung Wetan", "Kota / Kabupaten": "Kota Bandung", Provinsi: "Jawa Barat",
    })) {
      expect(screen.getByLabelText(label)).toHaveValue(value);
    }
    // Hydrating never calls the lookup route.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    unmount();

    const ayah = render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={prefill} />);
    expect(screen.getByLabelText("Kode pos")).toHaveValue("40116");
    expect(screen.getByLabelText("Provinsi")).toHaveValue("Jawa Barat");
    ayah.unmount();
    render(<PendaftaranClient initialStep={2} token="tok" programs={programs} prefill={prefill} />);
    expect(screen.getByLabelText("Perumahan / Jalan")).toHaveValue("Jl. Ibu");
    expect(screen.getByLabelText("Kota / Kabupaten")).toHaveValue("Kota Bandung");
  });

  it("an older draft without the new keys opens with them empty", () => {
    const prefill = withAddress({ address: { perumahan: "Taman Aster", kecamatan: "Cikarang", kodePos: "17530" } });
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={prefill} />);
    expect(screen.getByLabelText("Perumahan / Jalan")).toHaveValue("Taman Aster");
    expect(screen.getByLabelText("Kecamatan")).toHaveValue("Cikarang");
    expect(screen.getByLabelText("Kelurahan / Desa")).toHaveValue("");
    expect(screen.getByLabelText("Provinsi")).toHaveValue("");
  });
});

describe("address block: kode pos lookup inside the form", () => {
  it("fills the region boxes, autosaves all eight keys, and the saved blob passes the submit schema intact", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={base} />);
    await user.type(screen.getByLabelText("Perumahan / Jalan"), "Jl. Citarum 5");
    await user.type(screen.getByLabelText("Kode pos"), "40115");
    await waitFor(() => expect(screen.getByLabelText("Provinsi")).toHaveValue("Jawa Barat"));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/enrollments/token/tok/wilayah?kodepos=40115", expect.anything());

    await waitFor(() => {
      const last = patchBodies().at(-1);
      expect(last?.studentData.address.provinsi).toBe("Jawa Barat");
    }, { timeout: 4000 });
    const saved = patchBodies().at(-1);
    expect(saved.studentData.address).toEqual({
      perumahan: "Jl. Citarum 5", blokCluster: "", rtRw: "", kodePos: "40115",
      kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat",
    });
    expect(saved.ayahData.address).toEqual({ perumahan: "", blokCluster: "", rtRw: "", kodePos: "", kelurahan: "", kecamatan: "", kotaKab: "", provinsi: "" });

    // The same body goes to the submit route: its schema keeps the new keys and drops the blanks.
    const parsed = submitEnrollmentSchema.safeParse({
      ...saved,
      consentData: {
        agreed: true, version: CONSENT_VERSION,
        ayah: { name: "Budi", signatureToken: "supabase:v1:enrollment/abc/ayah-sig-0011.png" },
        ibu: { name: "Siti", signatureToken: "supabase:v1:enrollment/abc/ibu-sig-0022.png" },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.studentData.address).toEqual({
        perumahan: "Jl. Citarum 5", kodePos: "40115",
        kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat",
      });
    }
  });
});

describe("address block: kode pos checked on Lanjut", () => {
  it("a 4-digit kode pos blocks Lanjut on Data Anak with the inline error, focus, and no autosave", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={withAddress({ address: { kodePos: "4011" } })} />);

    await user.click(lanjut());

    expect(screen.getByRole("heading", { name: "Data Anak" })).toBeInTheDocument();
    const kodePos = screen.getByLabelText("Kode pos");
    expect(kodePos).toHaveAttribute("aria-invalid", "true");
    expect(kodePos).toHaveAccessibleDescription("Kode pos harus 5 angka.");
    expect(kodePos).toHaveFocus();
    expect(patchBodies()).toHaveLength(0);

    // Correcting it clears the message at once, and Lanjut goes through.
    await user.type(kodePos, "5");
    expect(kodePos).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Kode pos harus 5 angka.")).not.toBeInTheDocument();
    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ayah" })).toBeInTheDocument();
  });

  it("letters are never kept, so only a short code can block", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={base} />);
    await user.type(screen.getByLabelText("Kode pos"), "ab12");
    expect(screen.getByLabelText("Kode pos")).toHaveValue("12");
    await user.click(lanjut());
    expect(screen.getByLabelText("Kode pos")).toHaveFocus();
  });

  it("blocks Lanjut on a parent step too, but an empty address never blocks", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={withAddress({}, { address: { kodePos: "123" } })} />);
    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ayah" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kode pos")).toHaveFocus();
    expect(screen.getByLabelText("Kode pos")).toHaveAccessibleDescription("Kode pos harus 5 angka.");
    unmount();

    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={base} />);
    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ibu" })).toBeInTheDocument();
  });

  it("does not check the address of a parent who is waived", async () => {
    const user = userEvent.setup();
    const onlyIbu = {
      ...withAddress({}, { address: { kodePos: "123" } }),
      consentData: { agreed: true, version: CONSENT_VERSION, onlyParent: "ibu", ayah: { name: "", signed: false }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient initialStep={1} token="tok" programs={programs} prefill={onlyIbu} />);
    await user.click(lanjut());
    expect(screen.getByRole("heading", { name: "Data Ibu" })).toBeInTheDocument();
  });

  it("Kirim Formulir names the step when a malformed kode pos got as far as Tinjau", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={6} token="tok" programs={programs} prefill={withAddress({ address: { kodePos: "12" } })} />);
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
    expect(await screen.findByText(/Data Anak — Kode pos harus 5 angka\./)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith("/submit"))).toBe(false);
  });
});

describe("address block: Tinjau", () => {
  it("shows the full joined address for the child and each parent", () => {
    const prefill = withAddress({ address: FULL }, { address: { ...FULL, perumahan: "Jl. Ayah" } }, { address: { kecamatan: "Cikarang", kodePos: "17530" } });
    render(<PendaftaranClient initialStep={6} token="tok" programs={programs} prefill={prefill} />);
    const row = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(row("Alamat")).toBe(FULL_TEXT);
    expect(row("Alamat Ayah")).toBe(FULL_TEXT.replace("Jl. Citarum 5", "Jl. Ayah"));
    expect(row("Alamat Ibu")).toBe("Cikarang, 17530");
  });

  it("omits the row when there is no address, and the waived parent's row", () => {
    const onlyIbu = {
      ...withAddress({}, { address: FULL }, { address: FULL }),
      consentData: { agreed: true, version: CONSENT_VERSION, onlyParent: "ibu", ayah: { name: "", signed: false }, ibu: { name: "Siti", signed: true } },
    };
    render(<PendaftaranClient initialStep={6} token="tok" programs={programs} prefill={onlyIbu} />);
    expect(screen.queryByText("Alamat")).not.toBeInTheDocument();
    expect(screen.queryByText("Alamat Ayah")).not.toBeInTheDocument();
    expect(screen.getByText("Alamat Ibu").nextElementSibling).toHaveTextContent(FULL_TEXT);
  });
});
