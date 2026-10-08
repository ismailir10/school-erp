/**
 * Form motion layer (stepper progress, completed-check pop, enter-only step transition):
 * it must never change what the form exposes or when it appears.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PendaftaranClient from "../client";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";
import { stubMatchMedia } from "@/components/reactbits/__tests__/motion-test-utils";

vi.mock("@/components/enrollment/signature-pad", () => ({
  SignaturePad: ({ label }: { label: string }) => <div>{label}</div>,
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

function renderForm() {
  return render(<PendaftaranClient initialStep={0} token="tok" programs={programs} prefill={filled} />);
}

const lanjut = () => screen.getByRole("button", { name: "Lanjut" });
const kembali = () => screen.getByRole("button", { name: "Kembali" });
const heading = (name: string) => screen.getByRole("heading", { name });
/** The StepTransition element: the card's only child. */
const panelOf = (h: HTMLElement) => h.closest("div.overflow-x-clip")!.firstElementChild as HTMLElement;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("step transition on the enrollment form", () => {
  it("renders the next step's heading synchronously after Lanjut (no waiting on the animation)", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(heading("Data Anak")).toBeInTheDocument();

    await user.click(lanjut());
    // getBy, not findBy/waitFor: the DOM swap happens in the same commit as the state change.
    expect(heading("Data Ayah")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Data Anak" })).not.toBeInTheDocument();
  });

  it("slides in from the direction of travel: forward from the right, back and jumps from the left", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(lanjut());
    // Mid-flight the offset is somewhere between ±12px and 0, so assert the side, not the exact value.
    expect(panelOf(heading("Data Ayah")).style.transform).toMatch(/^translateX\(\d/);

    await user.click(kembali());
    expect(panelOf(heading("Data Anak")).style.transform).toMatch(/^translateX\(-/);

    // Jump to an earlier step through the stepper counts as going back too.
    await user.click(lanjut());
    await user.click(lanjut());
    await user.click(screen.getByRole("button", { name: "1. Data Anak" }));
    expect(panelOf(heading("Data Anak")).style.transform).toMatch(/^translateX\(-/);
  });

  it("applies no opacity or transform to the step panel under reduced motion", async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    renderForm();

    await user.click(lanjut());
    const panel = panelOf(heading("Data Ayah"));
    expect(panel.style.opacity).toBe("");
    expect(panel.style.transform).toBe("");
    expect(panel.getAttribute("style")).toBeNull();

    await user.click(kembali());
    expect(panelOf(heading("Data Anak")).getAttribute("style")).toBeNull();
  });

  it("clips horizontal overflow on the card that hosts the transition", () => {
    renderForm();
    expect(heading("Data Anak").closest("div.overflow-x-clip")).toBeInTheDocument();
  });

  it("still focuses the first bad field after the step remounted (Lanjut from a step reached by navigation)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(lanjut()); // Data Ayah, freshly remounted by StepTransition
    await user.type(screen.getByLabelText("No. HP"), "abc");
    await user.click(lanjut());
    expect(heading("Data Ayah")).toBeInTheDocument();
    expect(screen.getByLabelText("No. HP")).toHaveFocus();
  });
});

describe("stepper", () => {
  it("keeps the named list, one aria-current item, and visited steps as buttons with their original names", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(lanjut());
    await user.click(lanjut());

    const list = screen.getByRole("list", { name: "Langkah formulir" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    expect(items.filter((li) => li.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[2]).toHaveTextContent("3. Data Ibu");

    // Completed steps stay buttons; the check icon must not leak into their names.
    expect(within(list).getByRole("button", { name: "1. Data Anak" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "2. Data Ayah" })).toBeInTheDocument();
    expect(items.map((li) => li.textContent)).toEqual([
      "1. Data Anak",
      "2. Data Ayah",
      "3. Data Ibu",
      "4. Program",
      "5. Berkas",
      "6. Persetujuan",
      "7. Tinjau",
    ]);
    // Check icons: decorative, only on completed steps.
    expect(list.querySelectorAll("svg")).toHaveLength(2);
    list.querySelectorAll("svg").forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
  });

  it("fills the progress bar to the current step and hides the track from assistive tech", async () => {
    const user = userEvent.setup();
    renderForm();
    const fill = screen.getByTestId("stepper-progress");
    expect(fill).toHaveAttribute("data-step", "0");
    expect(fill.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(fill.style.transform).toContain("scaleX(0.14");

    await user.click(lanjut());
    await user.click(lanjut());
    expect(screen.getByTestId("stepper-progress")).toHaveAttribute("data-step", "2");
    await vi.waitFor(() => expect(screen.getByTestId("stepper-progress").style.transform).toContain("scaleX(0.42"));
    // Animates scale, never width.
    expect(fill.style.width).toBe("");
  });

  it("still reaches the right progress value under reduced motion", async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    renderForm();
    await user.click(lanjut());
    await vi.waitFor(() => expect(screen.getByTestId("stepper-progress").style.transform).toContain("scaleX(0.28"));
  });
});
