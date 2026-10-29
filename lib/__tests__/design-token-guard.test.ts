import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Design-token guard (design-tokens-v2, Decision 8). Static scan of app/ and
 * components/ so colour, spinner, tint and easing decisions stay in the token
 * layer instead of drifting back into raw utilities.
 */

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTIL =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|placeholder|caret|accent|shadow";

type Rule = { id: string; why: string; pattern: RegExp; skip?: (file: string) => boolean };

const RULES: Rule[] = [
  { id: "A", why: "raw Tailwind palette colour (use a semantic token)", pattern: new RegExp(`\\b(${UTIL})-(${PALETTE})-\\d{2,3}\\b`) },
  { id: "B", why: "arbitrary colour value in brackets (use a token)", pattern: /\[#[0-9a-fA-F]{3,8}\]|\[(rgb|rgba|hsl|hsla|oklch)\(/ },
  { id: "C", why: "hsl(var(--…)) is invalid: tokens are hex/rgba", pattern: /hsl\(var\(--/ },
  { id: "D", why: "spinner must come from components/ui/spinner.tsx", pattern: /\bLoader2\b|\banimate-spin\b/, skip: (f) => f === "components/ui/spinner.tsx" },
  { id: "E", why: "opacity tint on a semantic colour (use the -subtle token)", pattern: /\b(bg|text)-(success|warning|info|destructive)\/\d+/, skip: (f) => f.startsWith("components/ui/") },
  { id: "F", why: "easing literal duplicated (import from lib/motion.ts)", pattern: /0\.22,\s*1,\s*0\.36,\s*1/, skip: (f) => f === "lib/motion.ts" },
];

/**
 * Per-file, per-rule exceptions: { "path": { RULE_ID: "reason" } }. Keep empty
 * unless justified. components/ui/chart.tsx was checked and does not match B,
 * so it needs no entry. Stale entries fail the last tree-scan test.
 */
const ALLOWLIST: Record<string, Partial<Record<string, string>>> = {};

const SKIP_DIRS = new Set(["node_modules", "__tests__", "generated", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function findViolations(file: string, source: string, rule: Rule): string[] {
  if (rule.skip?.(file) || ALLOWLIST[file]?.[rule.id]) return [];
  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    const m = line.match(rule.pattern);
    if (m) hits.push(`${file}:${i + 1}  ${m[0]}`);
  });
  return hits;
}

const root = process.cwd();
const files = ["app", "components"]
  .flatMap((d) => walk(join(root, d)))
  .map((abs) => ({ file: relative(root, abs).split("\\").join("/"), source: readFileSync(abs, "utf8") }));

describe("design-token guard: tree scan", () => {
  for (const rule of RULES) {
    it(`rule ${rule.id}: no ${rule.why}`, () => {
      const hits = files.flatMap(({ file, source }) => findViolations(file, source, rule));
      expect(hits, `Rule ${rule.id} (${rule.why}):\n${hits.join("\n")}`).toEqual([]);
    });
  }

  it("allowlist entries still point at an existing file that matches the rule", () => {
    for (const [file, rules] of Object.entries(ALLOWLIST)) {
      for (const id of Object.keys(rules)) {
        const rule = RULES.find((r) => r.id === id)!;
        const entry = files.find((f) => f.file === file);
        expect(entry, `${file} no longer exists; drop its allowlist entry`).toBeDefined();
        expect(rule.pattern.test(entry!.source), `${file} no longer violates rule ${id}; drop the entry`).toBe(true);
      }
    }
  });
});

describe("design-token guard: matcher self-tests", () => {
  const hit = (id: string, s: string, file = "app/x/page.tsx") =>
    findViolations(file, s, RULES.find((r) => r.id === id)!).length > 0;

  it("A flags raw palette utilities, not tokens", () => {
    expect(hit("A", `className="bg-red-500 text-slate-700"`)).toBe(true);
    expect(hit("A", `className="bg-success-subtle text-destructive shadow-sticky-edge"`)).toBe(false);
  });

  it("B flags bracketed colours, not bracketed sizes", () => {
    expect(hit("B", `className="bg-[#ff0000]"`)).toBe(true);
    expect(hit("B", `className="shadow-[0_1px_rgba(0,0,0,0.1)] bg-[oklch(0.5_0.1_20)]"`)).toBe(true);
    expect(hit("B", `className="w-[120px] bg-primary shadow-sticky-edge"`)).toBe(false);
  });

  it("C flags hsl(var(--", () => {
    expect(hit("C", `color: "hsl(var(--primary))"`)).toBe(true);
    expect(hit("C", `color: "var(--primary)"`)).toBe(false);
  });

  it("D flags Loader2/animate-spin outside spinner.tsx only", () => {
    expect(hit("D", `<Loader2 className="animate-spin" />`)).toBe(true);
    expect(hit("D", `<Loader2 className="animate-spin" />`, "components/ui/spinner.tsx")).toBe(false);
    expect(hit("D", `<Spinner />`)).toBe(false);
  });

  it("E flags semantic opacity tints outside components/ui, allows borders", () => {
    expect(hit("E", `className="bg-success/10 text-warning/80"`)).toBe(true);
    expect(hit("E", `className="bg-success/10"`, "components/ui/badge.tsx")).toBe(false);
    expect(hit("E", `className="border-warning/40 bg-warning-subtle text-destructive"`)).toBe(false);
  });

  it("F flags the duplicated easing literal outside lib/motion.ts", () => {
    expect(hit("F", `ease: [0.22, 1, 0.36, 1]`)).toBe(true);
    expect(hit("F", `ease: [0.22, 1, 0.36, 1]`, "lib/motion.ts")).toBe(false);
    expect(hit("F", `ease: EASE_OUT`)).toBe(false);
  });
});

describe("design-system reference copy", () => {
  // /admin/design-system iframes the public copy; it had silently fallen a version behind the canonical file.
  it("public/admin/design-system-reference.html is identical to .claude/standards/design-system.html", () => {
    const canonical = readFileSync(join(root, ".claude/standards/design-system.html"), "utf8");
    const served = readFileSync(join(root, "public/admin/design-system-reference.html"), "utf8");
    expect(served === canonical, "run: cp .claude/standards/design-system.html public/admin/design-system-reference.html").toBe(true);
  });
});
