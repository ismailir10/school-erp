import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Design-reference parity (design-system-source-of-truth, Decisions 1 and 8).
 * `app/globals.css` owns every token value; the standalone reference HTML keeps
 * its own `:root`, so this guard catches a missing required token, value or
 * alias drift, and when a
 * `components/ui` primitive is missing from the reference's component inventory.
 */

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, ".claude/standards/design-system.html"), "utf8");
const GLOBALS = readFileSync(join(ROOT, "app/globals.css"), "utf8");

const stripComments = (css: string) =>
  css.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\/\*[\s\S]*?\*\//g, (_match, quoted) => quoted ?? "");

/** Body text of every top-level `<selector> { … }` block, with nested blocks removed. */
export function blockBodies(css: string, selector: RegExp): string[] {
  const src = stripComments(css);
  const bodies: string[] = [];
  const re = new RegExp(selector.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = src.indexOf("{", m.index + m[0].length - 1);
    if (i < 0) break;
    let depth = 0;
    let body = "";
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") {
        depth++;
        if (depth === 1) continue;
      } else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
      if (depth === 1) body += c;
    }
    bodies.push(body);
    re.lastIndex = i;
  }
  return bodies;
}

/** `--name: value;` pairs from the given blocks. Later blocks win. */
export function customProps(css: string, selectors: RegExp[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sel of selectors) {
    for (const body of blockBodies(css, sel)) {
      for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(d[1], d[2].trim());
    }
  }
  return out;
}

export function normalizeValue(v: string): string {
  return v
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/#[0-9a-f]{3,8}\b/gi, (h) => h.toLowerCase())
    .trim();
}

/** Missing tokens or mismatched declarations, including aliases. */
export function mismatches(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [name, av] of a) {
    const bv = b.get(name);
    if (bv === undefined) out.push(`${name}: missing from reference`);
    else if (normalizeValue(av) !== normalizeValue(bv)) out.push(`${name}: globals=${av} html=${bv}`);
  }
  return out;
}

const HTML_ROOT = [/(^|\n)\s*:root\s*\{/];
const GLOBALS_BLOCKS = [/(^|\n)\s*@theme[^{]*\{/, /(^|\n)\s*:root\s*\{/];

// The catalog covers the core palette, status and semantic triads, and the
// documented type, radius, spacing, elevation, motion and stacking scales.
const CORE = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "primary-text", "secondary", "secondary-foreground",
  "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border",
  "input", "ring", "radius", "shadow-sticky-edge",
].map((name) => `--${name}`);
// next/font binds these variables on the document body. The standalone HTML
// loads the same families directly and declares its own fallback stacks.
const NEXT_FONT_VARS = new Set(["--font-sans", "--font-mono"]);
const CATALOG_FAMILY = /^--(?:sidebar|status|success|warning|info|celebration-gold|destructive-|radius-|elevation|ease|transition-duration|z-index|space-|type-|text-)/;

describe("design reference: token parity with app/globals.css", () => {
  it("mirrors required tokens and every shared declaration, including aliases", () => {
    const html = customProps(HTML, HTML_ROOT);
    const globals = customProps(GLOBALS, GLOBALS_BLOCKS);
    const missingFromApp = [...new Set([...CORE, ...html.keys()])]
      .filter((name) => !NEXT_FONT_VARS.has(name) && !globals.has(name));
    expect(missingFromApp, "catalog tokens missing from globals.css").toEqual([]);
    const required = new Map(
      [...globals].filter(([name]) => !NEXT_FONT_VARS.has(name) && (CORE.includes(name) || CATALOG_FAMILY.test(name) || html.has(name))),
    );
    const bad = mismatches(required, html);
    expect(bad, `reference :root differs from globals.css:\n${bad.join("\n")}`).toEqual([]);
  });

  it("serves the exact canonical bytes without a runtime token override", () => {
    const canonical = readFileSync(join(ROOT, ".claude/standards/design-system.html"));
    const served = readFileSync(join(ROOT, "public/admin/design-system-reference.html"));
    expect(served.equals(canonical), "copy the canonical reference to public/admin").toBe(true);
    expect(HTML).not.toMatch(/<script\b|\bstyle\s*=\s*["'][^"']*--(?:ring|input|primary|radius|space-)[a-z-]*\s*:/i);
  });

  it("the reference declares no dark palette or theme toggle", () => {
    expect(/data-theme\s*=\s*["']dark["']/.test(HTML), "dark palette or toggle still present").toBe(false);
    expect(/--primary-hover/.test(HTML), "--primary-hover is not in globals.css").toBe(false);
  });
});

describe("design reference: component inventory", () => {
  it("lists every components/ui/*.tsx primitive", () => {
    const m = HTML.match(/<section[^>]*id="component-inventory"[\s\S]*?<\/section>/);
    expect(m, 'no <section id="component-inventory"> in the reference').not.toBeNull();
    const section = m![0];
    const files = readdirSync(join(ROOT, "components/ui"), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
      .map((e) => e.name.replace(/\.tsx$/, ""));
    expect(files.length).toBeGreaterThan(0);
    const missing = files.filter((f) => !new RegExp(`<code[^>]*>${f}</code>`).test(section));
    expect(missing, `missing from #component-inventory: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("design reference: parser", () => {
  const css = `@source not "../docs/**";\n/* c */ :root { --a: #ABC; --b:  1rem; /* --x: 1; */ }
@theme inline { --c: var(--a); @keyframes k { from { --z: 1; } } --d: 2px; }`;

  it("reads custom properties from named blocks and skips nested ones", () => {
    const p = customProps(css, [/(^|\n)\s*:root\s*\{/, /(^|\n)\s*@theme[^{]*\{/]);
    expect(Object.fromEntries(p)).toEqual({ "--a": "#ABC", "--b": "1rem", "--c": "var(--a)", "--d": "2px" });
  });

  it("normalizes whitespace and hex case", () => {
    expect(normalizeValue("#ABCDEF")).toBe("#abcdef");
    expect(normalizeValue("rgba(0,0,0,  0.1)")).toBe("rgba(0, 0, 0, 0.1)");
  });

  it("flags changed alias targets and required declarations removed from the reference", () => {
    const globals = new Map([["--p", "#FFF"], ["--q", "1rem"], ["--r", "var(--p)"], ["--missing", "1"]]);
    const html = new Map([["--p", "#fff"], ["--q", "2rem"], ["--r", "var(--q)"]]);
    expect(mismatches(globals, html)).toEqual([
      "--q: globals=1rem html=2rem",
      "--r: globals=var(--p) html=var(--q)",
      "--missing: missing from reference",
    ]);
  });
});
