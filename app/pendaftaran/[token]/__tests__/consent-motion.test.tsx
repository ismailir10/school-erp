/**
 * Motion on the consent step and the success screen: the clause reveal plays once per visit, the photo clause
 * gets one highlight, and none of it changes what the page exposes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";
import { CONSENT_CLAUSES, CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";
import { stubMatchMedia } from "@/components/reactbits/__tests__/motion-test-utils";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label, saved }: { label: string; saved: boolean }) => (
    <div>{`${label}: ${saved ? "tersimpan" : "kosong"}`}</div>
  ),
}));

const programs = [{ id: "p-1", name: "TK A" }];

const filled = {
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

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

const HIGHLIGHT = "animate-highlight-once";

const letterList = () =>
  screen.getByRole("heading", { name: "Surat Persetujuan Orang Tua" }).parentElement!.querySelector("ol") as HTMLElement;
const photo = () => screen.getByTestId("photo-consent-clause");

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => ok({})));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("consent clause reveal", () => {
  it("keeps 17 list items in one list, and the photo item keeps its attributes", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={filled} />);
    const ol = letterList();
    expect(ol.tagName).toBe("OL");
    const items = within(ol).getAllByRole("listitem");
    expect(items).toHaveLength(17);
    expect(items).toHaveLength(CONSENT_CLAUSES.length);

    expect(items[16]).toBe(photo());
    expect(photo()).toHaveAttribute("data-photo-clause");
    expect(photo().tagName).toBe("LI");
    expect(photo()).toHaveClass("ring-1", "bg-emerald-100/70");
    expect(within(photo()).getByText("Foto & video kegiatan").tagName).toBe("STRONG");
    expect(items.filter((li) => li.hasAttribute("data-photo-clause"))).toHaveLength(1);
  });

  it("plays the reveal and the photo highlight on first arrival", () => {
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={filled} />);
    const ol = letterList();
    expect(ol).toHaveAttribute("data-reveal", "true");
    // Framer starts the clauses hidden (inline style) and reveals them.
    expect(ol.querySelector(":scope > li")?.getAttribute("style")).not.toBeNull();
    expect(photo().className).toContain(HIGHLIGHT);
    expect(photo().className).toContain("motion-safe:[animation-delay:900ms]");
  });

  it("does not replay after going back to an earlier step and returning", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={filled} />);
    expect(letterList()).toHaveAttribute("data-reveal", "true");

    await user.click(screen.getByRole("button", { name: "Kembali" }));
    expect(screen.queryByRole("heading", { name: "Surat Persetujuan Orang Tua" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lanjut" }));
    const ol = letterList();
    expect(ol).toHaveAttribute("data-reveal", "false");
    expect(within(ol).getAllByRole("listitem")).toHaveLength(17);
    ol.querySelectorAll(":scope > li").forEach((li) => expect(li.getAttribute("style")).toBeNull());
    expect(ol.getAttribute("style")).toBeNull();
    expect(photo().className).not.toContain(HIGHLIGHT);
  });

  it("does not replay after jumping via the stepper either", async () => {
    const user = userEvent.setup();
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={filled} />);
    await user.click(screen.getByRole("button", { name: /Data Anak/ }));
    await user.click(screen.getByRole("button", { name: /Persetujuan/ }));
    expect(letterList()).toHaveAttribute("data-reveal", "false");
    expect(photo().className).not.toContain(HIGHLIGHT);
  });

  it("a later change in the same visit (ticking the box) does not drop the highlight mid-play", async () => {
    const user = userEvent.setup();
    render(
      <PendaftaranClient
        initialStep={5}
        token="tok"
        programs={programs}
        prefill={{ ...filled, consentData: { ...filled.consentData, agreed: false } }}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: /Kami sudah membaca/ }));
    expect(letterList()).toHaveAttribute("data-reveal", "true");
    expect(photo().className).toContain(HIGHLIGHT);
  });

  it("is static under reduced motion: no inline styles, no highlight class", () => {
    stubMatchMedia(true);
    render(<PendaftaranClient initialStep={5} token="tok" programs={programs} prefill={filled} />);
    const ol = letterList();
    expect(ol).toHaveAttribute("data-reveal", "false");
    expect(ol.getAttribute("style")).toBeNull();
    const items = within(ol).getAllByRole("listitem");
    expect(items).toHaveLength(17);
    items.forEach((li) => expect(li.getAttribute("style")).toBeNull());
    expect(photo().className).not.toContain(HIGHLIGHT);
    expect(photo()).toHaveAttribute("data-photo-clause");
  });
});

describe("success screen", () => {
  function stubSubmit() {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith("/submit")
          ? Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true }) } as Response)
          : ok({}),
      ),
    );
  }

  async function submit() {
    const user = userEvent.setup();
    render(<PendaftaranClient token="tok" programs={programs} prefill={filled} />);
    await user.click(screen.getByRole("button", { name: "Kirim Formulir" }));
    return screen.findByRole("heading", { name: "Jazakumullah khairan, Bapak/Ibu" });
  }

  it("still exposes the same headline, child name and bring-list rows", async () => {
    stubSubmit();
    const heading = await submit();
    expect(heading.tagName).toBe("H2");
    expect(screen.getByText(/Jazakumullah khairan, Bapak\/Ibu/)).toBeInTheDocument();
    expect(screen.getByText("Aisyah").tagName).toBe("STRONG");
    expect(screen.getByRole("heading", { name: "Berkas yang perlu dibawa ke sekolah" })).toBeInTheDocument();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
    // The decorative check is hidden from assistive tech.
    expect(document.querySelector("svg[aria-hidden='true'] circle")).not.toBeNull();
  });

  it("is static under reduced motion", async () => {
    stubMatchMedia(true);
    stubSubmit();
    await submit();
    const list = screen.getByRole("list");
    expect(list.getAttribute("style")).toBeNull();
    within(list)
      .getAllByRole("listitem")
      .forEach((li) => expect(li.getAttribute("style")).toBeNull());
  });
});
