/**
 * Address block of the public pendaftaran form: kode pos lookup (one / many /
 * none / failure), what a lookup may overwrite, the "Tidak tahu kode pos?" name
 * search, and the exported helpers. `fetch` is stubbed; the real route and its
 * data are covered by the wilayah route / lookup suites.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AddressFields,
  EMPTY_ADDRESS,
  addressFromBlob,
  kodePosError,
  type AddressValue,
} from "../address-fields";
import type { WilayahEntry } from "@/lib/wilayah/lookup";

const entry = (kodePos: string, kelurahan: string, kecamatan: string, kotaKab = "Kota Bandung", provinsi = "Jawa Barat"): WilayahEntry => ({
  kodePos, kelurahan, kecamatan, kotaKab, provinsi,
});

const CITARUM = entry("40115", "Citarum", "Bandung Wetan");
const TAMAN_SARI = entry("40116", "Taman Sari", "Bandung Wetan");
const JAYAPURA = [
  entry("99351", "Atabar", "Ebungfao", "Kabupaten Jayapura", "Papua"),
  entry("99351", "Netar", "Ebungfao", "Kabupaten Jayapura", "Papua"),
  entry("99351", "Sosiri", "Ebungfao", "Kabupaten Jayapura", "Papua"),
];
// Same kelurahan name in two kecamatan: the dropdown has to say which.
const MEKAR = [
  entry("12345", "Mekar", "Sukamaju"),
  entry("12345", "Mekar", "Cibodas"),
  entry("12345", "Jaya", "Cibodas"),
];

const KODE: Record<string, WilayahEntry[]> = {
  "40115": [CITARUM],
  "40116": [TAMAN_SARI],
  "99351": JAYAPURA,
  "12345": MEKAR,
};
const SEARCH: Record<string, WilayahEntry[]> = {
  citarum: [CITARUM, entry("40116", "Citarum Barat", "Bandung Wetan")],
  atabar: [JAYAPURA[0]],
  mekar: [MEKAR[1]],
};

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function Harness({
  initial = EMPTY_ADDRESS, showErrors, onValue, idPrefix = "student.address",
}: { initial?: AddressValue; showErrors?: boolean; onValue?: (v: AddressValue) => void; idPrefix?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AddressFields
      token="tok-1"
      legend="Alamat anak"
      idPrefix={idPrefix}
      showErrors={showErrors}
      value={value}
      onChange={(v) => {
        onValue?.(v);
        setValue(v);
      }}
    />
  );
}

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const status = () => screen.getByRole("status");

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    const sp = new URL(url, "http://localhost").searchParams;
    if (sp.has("kodepos")) return json(200, { results: KODE[sp.get("kodepos")!] ?? [] });
    return json(200, { results: SEARCH[(sp.get("q") ?? "").toLowerCase()] ?? [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("AddressFields — layout and kode pos input", () => {
  it("shows the eight boxes in order inside a named group", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Alamat anak" })).toBeInTheDocument();
    const labels = ["Perumahan / Jalan", "Blok / Cluster", "RT / RW", "Kode pos", "Kelurahan / Desa", "Kecamatan", "Kota / Kabupaten", "Provinsi"];
    const inputs = labels.map(box);
    for (let i = 1; i < inputs.length; i++) {
      expect(inputs[i - 1].compareDocumentPosition(inputs[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("asks for a numeric keyboard and postal-code autofill", () => {
    render(<Harness />);
    const kodePos = box("Kode pos");
    expect(kodePos).toHaveAttribute("inputmode", "numeric");
    expect(kodePos).toHaveAttribute("autocomplete", "section-student postal-code");
    expect(kodePos).not.toHaveAttribute("maxlength"); // would truncate a pasted "40 115" before it can be cleaned
    expect(kodePos).toHaveAttribute("data-field", "student.address.kodePos");
  });

  it("scopes postal-code autofill to the block, so the child, Ayah and Ibu never share one", () => {
    const { unmount } = render(<Harness idPrefix="ayah.address" />);
    expect(box("Kode pos")).toHaveAttribute("autocomplete", "section-ayah postal-code");
    unmount();
    const ibu = render(<Harness idPrefix="ibu.address" />);
    expect(box("Kode pos")).toHaveAttribute("autocomplete", "section-ibu postal-code");
    ibu.unmount();
    render(
      <AddressFields token="t" value={EMPTY_ADDRESS} onChange={() => {}} />,
    );
    expect(box("Kode pos")).toHaveAttribute("autocomplete", "postal-code");
  });

  it("strips non-digits as they are typed, stops at 5, and looks up only once", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "4a0-1x1 5");
    expect(box("Kode pos")).toHaveValue("40115");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
    expect(urls()).toEqual(["/api/enrollments/token/tok-1/wilayah?kodepos=40115"]);
  });

  it("cleans a pasted code (spaces, words) and an over-long value", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box("Kode pos"));
    await user.paste("40115");
    expect(box("Kode pos")).toHaveValue("40115");
    await user.clear(box("Kode pos"));
    await user.paste("40 116");
    expect(box("Kode pos")).toHaveValue("40116");
    await user.clear(box("Kode pos"));
    await user.paste("Bandung 40115");
    expect(box("Kode pos")).toHaveValue("40115");
    fireEvent.change(box("Kode pos"), { target: { value: "401-16" } });
    expect(box("Kode pos")).toHaveValue("40116");
    fireEvent.change(box("Kode pos"), { target: { value: "401169" } });
    expect(box("Kode pos")).toHaveValue("40116");
  });

  it("sends nothing before 5 digits and nothing on mount, even with a saved full code", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_ADDRESS, kodePos: "40115" }} />);
    await user.type(box("Perumahan / Jalan"), "Jl. A");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.clear(box("Kode pos"));
    await user.type(box("Kode pos"), "4011");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AddressFields — one match", () => {
  it("fills Kelurahan, Kecamatan, Kota / Kabupaten and Provinsi and says so", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
    expect(box("Kecamatan")).toHaveValue("Bandung Wetan");
    expect(box("Kota / Kabupaten")).toHaveValue("Kota Bandung");
    expect(box("Provinsi")).toHaveValue("Jawa Barat");
    expect(status()).toHaveTextContent("Wilayah terisi dari kode pos 40115. Silakan periksa.");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps every filled box editable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(box("Provinsi")).toHaveValue("Jawa Barat"));
    await user.type(box("Kecamatan"), " Baru");
    expect(box("Kecamatan")).toHaveValue("Bandung Wetan Baru");
  });
});

describe("AddressFields — several matches", () => {
  it("turns Kelurahan / Desa into a dropdown; picking one fills the rest", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "99351");
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(status()).toHaveTextContent("3 kelurahan untuk 99351 — pilih satu.");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Pilih kelurahan / desa", "Atabar", "Netar", "Sosiri", "Lainnya (ketik sendiri)",
    ]);
    // Nothing is guessed before the parent chooses.
    expect(box("Kecamatan")).toHaveValue("");

    await user.selectOptions(select, "Atabar");
    expect(box("Kecamatan")).toHaveValue("Ebungfao");
    expect(box("Kota / Kabupaten")).toHaveValue("Kabupaten Jayapura");
    expect(box("Provinsi")).toHaveValue("Papua");
    expect(screen.getByRole("combobox", { name: "Kelurahan / Desa" })).toHaveValue("0");
  });

  it("names the kecamatan in an option only when the kecamatan differ", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "12345");
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Pilih kelurahan / desa", "Mekar — Sukamaju", "Mekar — Cibodas", "Jaya — Cibodas", "Lainnya (ketik sendiri)",
    ]);
    await user.selectOptions(select, "Mekar — Cibodas");
    expect(box("Kecamatan")).toHaveValue("Cibodas");
    expect(screen.getByRole("combobox", { name: "Kelurahan / Desa" })).toHaveValue("1");
  });

  it("\"Lainnya\" brings back a text box, keeps what is in it, and can return to the list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "99351");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Kelurahan / Desa" }), "Lainnya (ketik sendiri)");
    const text = screen.getByRole("textbox", { name: "Kelurahan / Desa" });
    expect(text).toHaveFocus();
    await user.type(text, "Dusun Baru");
    expect(text).toHaveValue("Dusun Baru");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pilih dari daftar" }));
    const select = screen.getByRole("combobox", { name: "Kelurahan / Desa" });
    expect(select).toHaveFocus();
    // What was typed is still there, listed as the selected option: the select never hides a held value.
    expect(select).toHaveDisplayValue("Dusun Baru");
    expect(box("Kecamatan")).toHaveValue("");
  });

  it("drops the dropdown when the kode pos is edited but keeps the boxes, and brings it back for the same code without a second request", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "99351");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Kelurahan / Desa" }), "Netar");

    await user.type(box("Kode pos"), "{Backspace}");
    expect(box("Kode pos")).toHaveValue("9935");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(box("Kelurahan / Desa")).toHaveValue("Netar");
    expect(box("Kecamatan")).toHaveValue("Ebungfao");
    expect(status()).toBeEmptyDOMElement();

    await user.type(box("Kode pos"), "1");
    expect(await screen.findByRole("combobox", { name: "Kelurahan / Desa" })).toHaveValue("1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AddressFields — several matches and what is already in the boxes", () => {
  const typed = { ...EMPTY_ADDRESS, kelurahan: "Salah", kecamatan: "Salah Kec", kotaKab: "Kabupaten Jayapura", provinsi: "Papua" };

  it("clears a kelurahan that is not an option, and the region boxes the options do not all agree with", async () => {
    const user = userEvent.setup();
    render(<Harness initial={typed} />);
    await user.type(box("Kode pos"), "99351");
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(select).toHaveDisplayValue("Pilih kelurahan / desa");
    expect(box("Kecamatan")).toHaveValue(""); // "Salah Kec" is not Ebungfao
    expect(box("Kota / Kabupaten")).toHaveValue("Kabupaten Jayapura"); // every option shares it
    expect(box("Provinsi")).toHaveValue("Papua");
    expect(status()).toHaveTextContent("3 kelurahan untuk 99351 — pilih satu.");
  });

  it("keeps a typed region value that every option shares, and clears one that differs", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_ADDRESS, kelurahan: "Salah", kecamatan: "Ebungfao", kotaKab: "Kota Lain", provinsi: "Papua" }} />);
    await user.type(box("Kode pos"), "99351");
    await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(box("Kecamatan")).toHaveValue("Ebungfao");
    expect(box("Kota / Kabupaten")).toHaveValue("");
    expect(box("Provinsi")).toHaveValue("Papua");
  });

  it("keeps a kelurahan that is one of the options, with its other boxes, and does not ask to pick", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_ADDRESS, kelurahan: "Netar", kecamatan: "Ebungfao", kotaKab: "Kab. Saya", provinsi: "Papua" }} />);
    await user.type(box("Kode pos"), "99351");
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(select).toHaveDisplayValue("Netar");
    expect(box("Kota / Kabupaten")).toHaveValue("Kab. Saya");
    expect(status()).toHaveTextContent("Wilayah terisi dari kode pos 99351. Silakan periksa.");
  });

  it("a kelurahan name that matches in another kecamatan is not the option (kecamatan decides when they differ)", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_ADDRESS, kelurahan: "Jaya", kecamatan: "Sukamaju" }} />);
    await user.type(box("Kode pos"), "12345");
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(select).toHaveDisplayValue("Pilih kelurahan / desa");
    expect(box("Kecamatan")).toHaveValue("");
  });

  it("an unknown kode pos or a failure leaves every box as it is", async () => {
    const user = userEvent.setup();
    const held = { ...EMPTY_ADDRESS, kelurahan: "Desa Kita", kecamatan: "Kec. Kita", kotaKab: "Kab. Kita", provinsi: "Prov. Kita" };
    const { unmount } = render(<Harness initial={held} />);
    await user.type(box("Kode pos"), "00000");
    await waitFor(() => expect(status()).toHaveTextContent("tidak ditemukan"));
    for (const [label, v] of [["Kelurahan / Desa", "Desa Kita"], ["Kecamatan", "Kec. Kita"], ["Kota / Kabupaten", "Kab. Kita"], ["Provinsi", "Prov. Kita"]]) {
      expect(box(label)).toHaveValue(v);
    }
    unmount();

    fetchMock.mockImplementation(() => json(500, {}));
    render(<Harness initial={held} />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(status()).toHaveTextContent("tidak tersedia"));
    expect(box("Kelurahan / Desa")).toHaveValue("Desa Kita");
    expect(box("Provinsi")).toHaveValue("Prov. Kita");
  });
});

describe("AddressFields — no match and failures", () => {
  it("says an unknown kode pos was not found and leaves every box typeable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "00000");
    await waitFor(() => expect(status()).toHaveTextContent("Kode pos 00000 tidak ditemukan. Silakan isi manual."));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.type(box("Kelurahan / Desa"), "Desa Kita");
    await user.type(box("Provinsi"), "Bali");
    expect(box("Kelurahan / Desa")).toHaveValue("Desa Kita");
    expect(box("Provinsi")).toHaveValue("Bali");
  });

  it.each([
    ["a server error", () => json(500, { error: "x" })],
    ["rate limiting (429)", () => json(429, { error: "rate_limited" })],
    ["a closed link (410)", () => json(410, { error: "gone" })],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a body that is not region data", () => json(200, { nope: true })],
    ["an unreadable body", () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } } as unknown as Response)],
  ])("%s gives one quiet message and never blocks the boxes", async (_name, reply) => {
    fetchMock.mockImplementation(reply);
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(status()).toHaveTextContent("Pencarian kode pos tidak tersedia, silakan isi manual."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(box("Kecamatan"), "Bandung Wetan");
    expect(box("Kecamatan")).toHaveValue("Bandung Wetan");
    expect(box("Kode pos")).toHaveValue("40115");
  });

  it("retries after a failure when the code is typed again", async () => {
    fetchMock.mockImplementationOnce(() => json(500, {}));
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(status()).toHaveTextContent("tidak tersedia"));
    await user.type(box("Kode pos"), "{Backspace}5");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says it is searching while the request is open", async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    expect(status()).toHaveTextContent("Mencari…");
    pending.resolve(await json(200, { results: [CITARUM] }));
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
  });
});

describe("AddressFields — requests", () => {
  it("ignores a response that arrives after the kode pos changed", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box("Kode pos"), "40115");
    await user.type(box("Kode pos"), "{Backspace}6"); // 4011 -> 40116: the first request is abandoned
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);

    second.resolve(await json(200, { results: [TAMAN_SARI] }));
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Taman Sari"));

    first.resolve(await json(200, { results: [CITARUM] })); // late: must change nothing
    await new Promise((r) => setTimeout(r, 20));
    expect(box("Kelurahan / Desa")).toHaveValue("Taman Sari");
    expect(box("Kode pos")).toHaveValue("40116");
    expect(status()).toHaveTextContent("Wilayah terisi dari kode pos 40116.");
  });

  it("does not fetch the same code twice (a repeated change event, a retyped code)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
    fireEvent.change(box("Kode pos"), { target: { value: "40115" } });
    fireEvent.change(box("Kode pos"), { target: { value: "40115" } });
    await user.type(box("Kode pos"), "{Backspace}5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts an open request when the form goes away", async () => {
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    unmount();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });
});

describe("AddressFields — what a lookup may overwrite", () => {
  it("a single match overwrites all four region boxes, whatever they held", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...EMPTY_ADDRESS, kelurahan: "Lama", kecamatan: "Wetan Kita", kotaKab: "Kota Lama", provinsi: "Prov Lama" }} />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
    expect(box("Kecamatan")).toHaveValue("Bandung Wetan");
    expect(box("Kota / Kabupaten")).toHaveValue("Kota Bandung");
    expect(box("Provinsi")).toHaveValue("Jawa Barat");
  });

  it("does the same for a second code, even after the parent edited a filled box", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Citarum"));
    await user.type(box("Kota / Kabupaten"), " X");

    await user.clear(box("Kode pos"));
    await user.type(box("Kode pos"), "40116");
    await waitFor(() => expect(box("Kelurahan / Desa")).toHaveValue("Taman Sari"));
    expect(box("Kota / Kabupaten")).toHaveValue("Kota Bandung");
    // ...and the street boxes are never touched.
    expect(box("Perumahan / Jalan")).toHaveValue("");
  });

  it("an explicit pick from the dropdown replaces the region boxes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box("Provinsi"), "Salah");
    await user.type(box("Kode pos"), "99351");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Kelurahan / Desa" }), "Sosiri");
    expect(box("Provinsi")).toHaveValue("Papua");
    expect(box("Kota / Kabupaten")).toHaveValue("Kabupaten Jayapura");
  });

  it("leaves the street boxes alone and reports every change as one complete value", async () => {
    const seen: AddressValue[] = [];
    const user = userEvent.setup();
    render(<Harness onValue={(v) => seen.push(v)} />);
    await user.type(box("Perumahan / Jalan"), "Jl. Citarum 5");
    await user.type(box("Kode pos"), "40115");
    await waitFor(() => expect(box("Provinsi")).toHaveValue("Jawa Barat"));
    expect(seen.at(-1)).toEqual({
      perumahan: "Jl. Citarum 5", blokCluster: "", rtRw: "", kodePos: "40115",
      kelurahan: "Citarum", kecamatan: "Bandung Wetan", kotaKab: "Kota Bandung", provinsi: "Jawa Barat",
    });
  });
});

describe("AddressFields — Tidak tahu kode pos?", () => {
  async function openSearch() {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: "Tidak tahu kode pos?" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    return { user, search: screen.getByLabelText("Cari kelurahan atau kecamatan") };
  }

  it("finds a place by name, fills all five region boxes including the kode pos, and closes", async () => {
    const { user, search } = await openSearch();
    expect(search).toHaveFocus();
    await user.type(search, "citarum");
    const pick = await screen.findByRole("button", { name: "Citarum, Bandung Wetan — Kota Bandung (40115)" });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // Typed in one go: one debounced request, not one per key.
    expect(urls()).toEqual(["/api/enrollments/token/tok-1/wilayah?q=citarum"]);

    await user.click(pick);
    expect(box("Kode pos")).toHaveValue("40115");
    expect(box("Kelurahan / Desa")).toHaveValue("Citarum");
    expect(box("Kecamatan")).toHaveValue("Bandung Wetan");
    expect(box("Kota / Kabupaten")).toHaveValue("Kota Bandung");
    expect(box("Provinsi")).toHaveValue("Jawa Barat");
    expect(screen.queryByLabelText("Cari kelurahan atau kecamatan")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Tidak tahu kode pos?" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    // The normal kode pos lookup then runs for the picked code; one match changes nothing visible.
    await waitFor(() => expect(urls()).toEqual([
      "/api/enrollments/token/tok-1/wilayah?q=citarum",
      "/api/enrollments/token/tok-1/wilayah?kodepos=40115",
    ]));
    await waitFor(() => expect(status()).toHaveTextContent("Wilayah terisi dari kode pos 40115. Silakan periksa."));
    expect(box("Kelurahan / Desa")).toHaveValue("Citarum");
  });

  it("a picked kelurahan stays selected when its kode pos has several matches, with the other boxes kept", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "atabar");
    await user.click(await screen.findByRole("button", { name: "Atabar, Ebungfao — Kabupaten Jayapura (99351)" }));
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(select).toHaveDisplayValue("Atabar");
    expect(box("Kecamatan")).toHaveValue("Ebungfao");
    expect(box("Kota / Kabupaten")).toHaveValue("Kabupaten Jayapura");
    expect(box("Provinsi")).toHaveValue("Papua");
    expect(status()).toHaveTextContent("Wilayah terisi dari kode pos 99351. Silakan periksa.");
  });

  it("picking from a kode pos shared across kecamatan keeps the picked one selected", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "mekar");
    await user.click(await screen.findByRole("button", { name: /^Mekar, Cibodas/ }));
    const select = await screen.findByRole("combobox", { name: "Kelurahan / Desa" });
    expect(select).toHaveDisplayValue("Mekar — Cibodas");
    expect(box("Kecamatan")).toHaveValue("Cibodas");
  });

  it("Escape closes the panel and puts focus back on the toggle; the query is forgotten", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "citarum");
    await screen.findByRole("list");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Cari kelurahan atau kecamatan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tidak tahu kode pos?" })).toHaveFocus();
  });

  it("Escape works from a result button too", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "citarum");
    const first = await screen.findByRole("button", { name: /^Citarum, Bandung Wetan/ });
    first.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Cari kelurahan atau kecamatan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tidak tahu kode pos?" })).toHaveFocus();
  });

  it("Enter picks the only result", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "atabar");
    await screen.findByRole("button", { name: /^Atabar/ });
    await user.keyboard("{Enter}");
    expect(box("Kode pos")).toHaveValue("99351");
    expect(box("Kelurahan / Desa")).not.toHaveValue("");
    expect(screen.queryByLabelText("Cari kelurahan atau kecamatan")).not.toBeInTheDocument();
  });

  it("Enter with several results, or before the results arrive, picks nothing", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "citarum{Enter}"); // before the debounce fires
    expect(screen.getByLabelText("Cari kelurahan atau kecamatan")).toBeInTheDocument();
    await screen.findByRole("list");
    await user.type(screen.getByLabelText("Cari kelurahan atau kecamatan"), "{Enter}"); // two results
    expect(screen.getByLabelText("Cari kelurahan atau kecamatan")).toBeInTheDocument();
    expect(box("Kode pos")).toHaveValue("");
  });

  it("replaces region boxes the parent typed, because the parent chose this result", async () => {
    const { user, search } = await openSearch();
    await user.type(box("Provinsi"), "Salah");
    await user.type(search, "citarum");
    await user.click(await screen.findByRole("button", { name: /^Citarum, Bandung Wetan/ }));
    expect(box("Provinsi")).toHaveValue("Jawa Barat");
  });

  it("sends nothing for fewer than 3 letters", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "ci");
    await user.clear(search);
    await user.type(search, "a  b"); // spaces do not count
    await new Promise((r) => setTimeout(r, 450));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("drops a pending search when the text shrinks below 3 letters", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "citarum");
    await user.clear(search);
    await user.type(search, "ci");
    await new Promise((r) => setTimeout(r, 450));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "zzzz");
    await waitFor(() => expect(status()).toHaveTextContent("Tidak ditemukan. Coba nama lain atau isi manual."));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("gives one quiet message when the search fails", async () => {
    fetchMock.mockImplementation(() => json(429, { error: "rate_limited" }));
    const { user, search } = await openSearch();
    await user.type(search, "citarum");
    await waitFor(() => expect(status()).toHaveTextContent("Pencarian tidak tersedia, silakan isi manual."));
    expect(box("Kecamatan")).toBeEnabled();
  });

  it("closes from the same button and forgets the query", async () => {
    const { user, search } = await openSearch();
    await user.type(search, "citarum");
    await screen.findByRole("list");
    await user.click(screen.getByRole("button", { name: "Tutup pencarian" }));
    expect(screen.queryByLabelText("Cari kelurahan atau kecamatan")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tidak tahu kode pos?" }));
    expect(screen.getByLabelText("Cari kelurahan atau kecamatan")).toHaveValue("");
  });

  it("uses one polite live region for every message", async () => {
    const { user, search } = await openSearch();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status()).toHaveAttribute("aria-live", "polite");
    await user.type(search, "zzzz");
    await waitFor(() => expect(status()).toHaveTextContent("Tidak ditemukan"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("AddressFields — kode pos error", () => {
  it("shows the format error inline only when asked, tied to the input", async () => {
    const { rerender } = render(<AddressFields token="t" value={{ ...EMPTY_ADDRESS, kodePos: "4011" }} onChange={() => {}} />);
    expect(screen.queryByText("Kode pos harus 5 angka.")).not.toBeInTheDocument();
    expect(box("Kode pos")).not.toHaveAttribute("aria-invalid");

    rerender(<AddressFields token="t" value={{ ...EMPTY_ADDRESS, kodePos: "4011" }} onChange={() => {}} showErrors />);
    const msg = screen.getByText("Kode pos harus 5 angka.");
    expect(box("Kode pos")).toHaveAttribute("aria-invalid", "true");
    expect(box("Kode pos").getAttribute("aria-describedby")).toBe(msg.id);

    rerender(<AddressFields token="t" value={{ ...EMPTY_ADDRESS, kodePos: "40115" }} onChange={() => {}} showErrors />);
    expect(screen.queryByText("Kode pos harus 5 angka.")).not.toBeInTheDocument();
  });
});

describe("kodePosError", () => {
  it("accepts empty and exactly 5 digits", () => {
    expect(kodePosError({ kodePos: "" })).toBeNull();
    expect(kodePosError({ kodePos: "   " })).toBeNull();
    expect(kodePosError({ kodePos: "40115" })).toBeNull();
    expect(kodePosError({ kodePos: " 40115 " })).toBeNull();
  });

  it("flags anything else", () => {
    for (const kodePos of ["4", "4011", "401155", "4011a", "abcde", "40 115"]) {
      expect(kodePosError({ kodePos })).toBe("Kode pos harus 5 angka.");
    }
  });
});

describe("addressFromBlob", () => {
  it("hydrates all eight keys", () => {
    const full = {
      perumahan: "P", blokCluster: "B", rtRw: "1/2", kodePos: "40115",
      kelurahan: "K", kecamatan: "C", kotaKab: "Kota", provinsi: "Jabar",
    };
    expect(addressFromBlob(full)).toEqual(full);
  });

  it("fills missing keys of an old blob with empty strings", () => {
    expect(addressFromBlob({ perumahan: "Taman Aster", kecamatan: "Cikarang", kodePos: "17530" })).toEqual({
      ...EMPTY_ADDRESS, perumahan: "Taman Aster", kecamatan: "Cikarang", kodePos: "17530",
    });
  });

  it("tolerates null, junk and wrongly typed values, and drops unknown keys", () => {
    for (const junk of [null, undefined, "x", 5, [], true]) expect(addressFromBlob(junk)).toEqual(EMPTY_ADDRESS);
    expect(addressFromBlob({ perumahan: 5, rtRw: null, kodePos: {}, kelurahan: ["x"], negara: "ID" })).toEqual({
      ...EMPTY_ADDRESS, perumahan: "5",
    });
  });

  it("returns a fresh object each time", () => {
    expect(addressFromBlob(null)).not.toBe(EMPTY_ADDRESS);
  });
});
