import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deck } from "../deck";
import { PARENT_SLIDES } from "../parent-slides";
import { SLIDES } from "../slides";

function mount() {
  return render(<Deck slides={SLIDES} homeHref="/admin" homeLabel="Dasbor admin" />);
}

/** The live region is the one place the current slide is spoken. */
const announced = () => document.querySelector("[aria-live='polite']")?.textContent ?? "";

beforeEach(() => {
  window.history.replaceState(null, "", "/guide");
});
afterEach(() => cleanup());

describe("Deck", () => {
  it("is at most twenty slides, with unique ids", () => {
    expect(SLIDES.length).toBeLessThanOrEqual(20);
    expect(new Set(SLIDES.map((s) => s.id)).size).toBe(SLIDES.length);
  });

  it("opens on the cover, announces it, and exposes one rail button per slide", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(SLIDES[0].title);
    expect(announced()).toBe(`Slide 1 dari ${SLIDES.length}: ${SLIDES[0].title}`);

    const rail = screen.getByRole("navigation", { name: "Daftar slide" });
    const dots = within(rail).getAllByRole("button");
    expect(dots).toHaveLength(SLIDES.length);
    expect(dots[0]).toHaveAttribute("aria-current", "step");
    expect(dots[1]).not.toHaveAttribute("aria-current");
  });

  it("moves with the arrow keys, writes the hash, and stops at both ends", () => {
    mount();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(window.location.hash).toBe("");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(window.location.hash).toBe("#2");
    expect(announced()).toContain("Slide 2 dari");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(SLIDES[1].title);

    fireEvent.keyDown(window, { key: "End" });
    expect(window.location.hash).toBe(`#${SLIDES.length}`);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(window.location.hash).toBe(`#${SLIDES.length}`);
    expect(screen.getByRole("button", { name: "Slide berikutnya" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Home" });
    expect(window.location.hash).toBe("#1");
    expect(screen.getByRole("button", { name: "Slide sebelumnya" })).toBeDisabled();
  });

  it("pages with PageDown/PageUp and Space/Shift+Space", () => {
    mount();
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: " " });
    expect(window.location.hash).toBe("#3");
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(window.location.hash).toBe("#1");
  });

  it("leaves Space to a focused button instead of also changing slide", async () => {
    mount();
    const dots = within(screen.getByRole("navigation", { name: "Daftar slide" })).getAllByRole("button");
    dots[4].focus();
    fireEvent.keyDown(dots[4], { key: " " });
    expect(window.location.hash).toBe("");
  });

  it("ignores shortcuts that carry a modifier (browser and OS own those)", () => {
    mount();
    fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    expect(window.location.hash).toBe("");
  });

  it("restores the slide from the URL hash and falls back to the cover for junk", () => {
    window.history.replaceState(null, "", "/guide#5");
    const { unmount } = mount();
    expect(announced()).toContain("Slide 5 dari");
    unmount();

    window.history.replaceState(null, "", "/guide#99");
    mount();
    expect(announced()).toContain("Slide 1 dari");
  });

  it("jumps from the progress rail and from the next/previous buttons", async () => {
    const user = userEvent.setup();
    mount();
    const rail = screen.getByRole("navigation", { name: "Daftar slide" });
    await user.click(within(rail).getByRole("button", { name: new RegExp(`^Slide 7: ${SLIDES[6].nav}`) }));
    expect(window.location.hash).toBe("#7");

    await user.click(screen.getByRole("button", { name: "Slide berikutnya" }));
    expect(window.location.hash).toBe("#8");
    await user.click(screen.getByRole("button", { name: "Slide sebelumnya" }));
    expect(window.location.hash).toBe("#7");
  });

  it("follows the browser's own hash changes", () => {
    mount();
    act(() => {
      window.history.replaceState(null, "", "/guide#3");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(announced()).toContain("Slide 3 dari");
  });

  it("links back to the viewer's own portal", () => {
    mount();
    expect(screen.getByRole("link", { name: "Kembali ke Dasbor admin" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Kembali" })).toHaveAttribute("href", "/admin");
  });
});

describe("Deck title", () => {
  it("names the deck in the header and the carousel label", () => {
    render(<Deck slides={PARENT_SLIDES} title="Panduan orang tua" homeHref="/parent" homeLabel="Beranda orang tua" />);
    expect(screen.getByRole("main", { name: "Panduan orang tua" })).toBeInTheDocument();
  });
});

describe("Deck content", () => {
  // The legal pages were made vendor-neutral on 2026-10-09 (DOKU is the one named payment party), and
  // this school says "Bu Guru", never "Ustadz/Ustadzah" (voice.md). The deck follows both.
  const FORBIDDEN = /supabase|vercel|resend|cloudflare|xendit|ustadz|ustadzah/i;

  it("renders every slide with a heading, a lead, and none of the banned words", () => {
    mount();
    for (let i = 1; i <= SLIDES.length; i++) {
      act(() => {
        window.history.replaceState(null, "", `/guide#${i}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      const slide = screen.getByRole("group", { name: `${i} dari ${SLIDES.length}` });
      const heading = within(slide).getByRole("heading", { level: i === 1 ? 1 : 2 });
      expect(heading).toHaveTextContent(SLIDES[i - 1].title);
      expect(slide.textContent).toContain(SLIDES[i - 1].lead);
      expect(slide.textContent ?? "").not.toMatch(FORBIDDEN);
      // Mock screens are pictures: hidden from assistive tech, inert, and with nothing focusable inside.
      for (const mock of slide.querySelectorAll("[data-art]")) {
        expect(mock).toHaveAttribute("aria-hidden", "true");
        expect(mock.querySelector("button, a[href], input, select, textarea, [tabindex]")).toBeNull();
      }
    }
  });

  it("teaches the shipped admissions flow: pay after the form, walk-in, one-click convert", () => {
    const slide = SLIDES.find((s) => s.id === "pendaftaran");
    const copy = [slide?.title, slide?.lead, ...(slide?.steps ?? []).flatMap((st) => [st.title, st.text])].join(" ");
    expect(slide?.steps).toHaveLength(4);
    expect(copy).toMatch(/dibayar setelah formulir dikirim|membayar biaya pendaftaran setelah formulir dikirim/);
    expect(copy).not.toMatch(/bayar dulu|membayar dulu|membayar biaya formulir dulu/);
    expect(copy).toMatch(/Kirim Formulir/);
    expect(copy).toMatch(/Terima & Jadikan Siswa/);
    expect(copy).toMatch(/diisi bersama/);
    // The visit steps and the emailed-only invite are retired.
    expect(copy).not.toMatch(/Kunjungan|Undangan|mengonversi/);
  });

  it("marks the modules still in cutover and nothing else", () => {
    const flagged = SLIDES.filter((s) => s.badge).map((s) => s.id);
    expect(flagged).toEqual(["kurikulum", "penilaian", "rapor"]);
  });

  it("teaches none of the retired finance and curriculum rules", () => {
    const copy = SLIDES.flatMap((s) => [s.title, s.lead, ...(s.steps ?? []).flatMap((st) => [st.title, st.text])]).join(" ");
    // "Sudah dibayar" left Tagihan Manual in #704; curriculum authoring is no longer owner-only (#691).
    expect(copy).not.toMatch(/Sudah dibayar|Pemilik menyusun/);
    expect(copy).toMatch(/Catat pembayaran di muka/);
  });
});

describe("Parent deck content", () => {
  const FORBIDDEN = /supabase|vercel|resend|cloudflare|xendit|ustadz|ustadzah/i;

  it("renders every slide with a heading and a lead, in the parent voice", () => {
    expect(PARENT_SLIDES.length).toBeLessThanOrEqual(20);
    expect(new Set(PARENT_SLIDES.map((s) => s.id)).size).toBe(PARENT_SLIDES.length);
    render(<Deck slides={PARENT_SLIDES} title="Panduan orang tua" homeHref="/parent" homeLabel="Beranda orang tua" />);
    for (let i = 1; i <= PARENT_SLIDES.length; i++) {
      act(() => {
        window.history.replaceState(null, "", `/guide/parents#${i}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      const slide = screen.getByRole("group", { name: `${i} dari ${PARENT_SLIDES.length}` });
      expect(within(slide).getByRole("heading", { level: i === 1 ? 1 : 2 })).toHaveTextContent(PARENT_SLIDES[i - 1].title);
      expect(slide.textContent).toContain(PARENT_SLIDES[i - 1].lead);
      expect(slide.textContent ?? "").not.toMatch(FORBIDDEN);
      // One audience: no "Dipakai oleh" chips repeating "Orang tua" on every slide.
      expect(slide.textContent ?? "").not.toContain("Dipakai oleh");
      for (const mock of slide.querySelectorAll("[data-art]")) {
        expect(mock).toHaveAttribute("aria-hidden", "true");
        expect(mock.querySelector("button, a[href], input, select, textarea, [tabindex]")).toBeNull();
      }
    }
  });

  it("speaks to parents, not staff: no admin menu names", () => {
    const copy = PARENT_SLIDES.flatMap((s) => [s.title, s.lead, ...(s.steps ?? []).flatMap((st) => [st.title, st.text])]).join(" ");
    expect(copy).toMatch(/Assalamu'alaikum/);
    expect(copy).not.toMatch(/Buat Tagihan|Antrean pekerjaan|Terima & Jadikan Siswa|Dasbor|wizard/i);
  });
});
