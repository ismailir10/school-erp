import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the m6 fix: the brand teal is a fill colour, and using it as text on
 * a tinted surface put the *checked* (meaningful) journal state at 2.24:1
 * while the unchecked state used near-black. `--primary-text` exists to carry
 * brand colour into text; this test is what stops it drifting back toward
 * `--primary` for looking prettier.
 */

const CSS = readFileSync(
  join(process.cwd(), "app", "globals.css"),
  "utf8",
);

function readToken(name: string): string {
  const m = CSS.match(
    new RegExp(`^\\s*--${name}:\\s*(#[0-9A-Fa-f]{6}|var\\(--([a-z-]+)\\));`, "m"),
  );
  if (!m) throw new Error(`token --${name} not found in app/globals.css`);
  return m[2] ? readToken(m[2]) : m[1]!.toUpperCase();
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Flatten `fg` at `alpha` over opaque `bg` — what Tailwind's /10 renders as. */
function blend(fg: string, bg: string, alpha: number): string {
  const f = channels(fg);
  const b = channels(bg);
  return (
    "#" +
    f
      .map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

const WHITE = "#FFFFFF";

describe("--primary-text contrast", () => {
  const primary = readToken("primary");
  const primaryText = readToken("primary-text");

  // `bg-primary/10` on a white card — the checked journal cell background.
  const tint10 = blend(primary, WHITE, 0.1);
  // `bg-primary/5` — the parent week-grid today column.
  const tint5 = blend(primary, WHITE, 0.05);

  it("documents why the fill colour cannot be used as text", () => {
    expect(contrast(primary, tint10)).toBeLessThan(4.5);
    expect(contrast(primary, WHITE)).toBeLessThan(3);
  });

  it("clears AA body text on the tinted journal cell", () => {
    expect(contrast(primaryText, tint10)).toBeGreaterThanOrEqual(4.5);
  });

  it("clears AA on the week-grid tint and on plain white", () => {
    expect(contrast(primaryText, tint5)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(primaryText, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["background", "secondary", "muted"])("clears AA on --%s", (surface) => {
    expect(contrast(primaryText, readToken(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it("clears the 3:1 non-text-graphic threshold for the check glyph", () => {
    expect(contrast(primaryText, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(primaryText, tint5)).toBeGreaterThanOrEqual(3);
  });

  it("is exposed to Tailwind as a colour utility", () => {
    expect(CSS).toMatch(/--color-primary-text:\s*var\(--primary-text\);/);
  });
});

describe("control and keyboard focus contrast", () => {
  it.each(["background", "card", "muted", "accent"])(
    "distinguishes form boundaries from the --%s surface",
    (surface) => {
      expect(contrast(readToken("input"), readToken(surface))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(["background", "card", "primary", "secondary", "muted", "input"])(
    "distinguishes the focus outline from the --%s surface",
    (surface) => {
      expect(contrast(readToken("ring"), readToken(surface))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(["sidebar", "sidebar-accent"])("shows focus on --%s", (surface) => {
    expect(contrast(readToken("sidebar-ring"), readToken(surface))).toBeGreaterThanOrEqual(3);
  });

  it.each(["background", "card", "destructive-subtle"])(
    "shows the invalid focus outline on --%s",
    (surface) => {
      expect(contrast(readToken("destructive-text"), readToken(surface))).toBeGreaterThanOrEqual(3);
    },
  );
});
