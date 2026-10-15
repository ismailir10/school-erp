import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deck } from "../deck";
import { SLIDES } from "../slides";

function mount() {
  return render(<Deck slides={SLIDES} homeHref="/admin" homeLabel="Dasbor admin" />);
}

/** The live region is the one place the current slide is spoken. */
const announced = () => document.querySelector("[aria-live='polite']")?.textContent ?? "";

beforeEach(() => {
  window.history.replaceState(null, "", "/panduan");
});
afterEach(() => cleanup());

describe("Deck", () => {
  it("is at most ten slides, with unique ids", () => {
    expect(SLIDES.length).toBeLessThanOrEqual(10);
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
    window.history.replaceState(null, "", "/panduan#5");
    const { unmount } = mount();
    expect(announced()).toContain("Slide 5 dari");
    unmount();

    window.history.replaceState(null, "", "/panduan#99");
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
      window.history.replaceState(null, "", "/panduan#3");
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

describe("Deck content", () => {
  // The legal pages were made vendor-neutral on 2026-10-09 (DOKU is the one named payment party), and
  // this school says "Bu Guru", never "Ustadz/Ustadzah" (voice.md). The deck follows both.
  const FORBIDDEN = /supabase|vercel|resend|cloudflare|xendit|ustadz|ustadzah/i;

  it("renders every slide with a heading, a lead, and none of the banned words", () => {
    mount();
    for (let i = 1; i <= SLIDES.length; i++) {
      act(() => {
        window.history.replaceState(null, "", `/panduan#${i}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      const slide = screen.getByRole("group", { name: `${i} dari ${SLIDES.length}` });
      const heading = within(slide).getByRole("heading", { level: i === 1 ? 1 : 2 });
      expect(heading).toHaveTextContent(SLIDES[i - 1].title);
      expect(slide.textContent).toContain(SLIDES[i - 1].lead);
      expect(slide.textContent ?? "").not.toMatch(FORBIDDEN);
    }
  });

  it("teaches the shipped admissions flow: pay after the form, walk-in, one-click convert", () => {
    const slide = SLIDES.find((s) => s.id === "kesiswaan");
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

  it("marks the two modules still in cutover and nothing else", () => {
    const flagged = SLIDES.filter((s) => s.badge).map((s) => s.id);
    expect(flagged).toEqual(["kurikulum", "rapor"]);
  });
});
