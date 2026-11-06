import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { TITLE_TEMPLATE, pageTitle } from "@/lib/page-title";

/**
 * Every routable page must set its own browser-tab title. Without one the tab
 * falls back to the root default ("Talib — by An Nisaa' Sekolahku"), so ten
 * open tabs are indistinguishable and history/bookmarks lose the page name.
 *
 * A page is covered when it, or a layout between it and `app/`, exports
 * `metadata` / `generateMetadata`. Client pages cannot export metadata, which
 * is why they get a sibling `layout.tsx`. The root layout does not count: its
 * title is the fallback this test exists to keep from being the only one.
 */

const APP_DIR = path.resolve(__dirname, "..");

// Pages that never render: they redirect immediately. `app/page.tsx` is the
// login screen, which deliberately keeps the brand-level root title.
const EXEMPT = new Set([
  "page.tsx",
  "admin/enrollments/page.tsx",
  "payment/success/page.tsx",
  "payment/cancel/page.tsx",
  "teacher/sessions/page.tsx",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "api" || name === "__tests__" || name === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const EXPORTS_METADATA = /export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b)/;

function hasMetadata(file: string): boolean {
  return existsSync(file) && EXPORTS_METADATA.test(readFileSync(file, "utf8"));
}

function covered(pageFile: string): boolean {
  if (hasMetadata(pageFile)) return true;
  let dir = path.dirname(pageFile);
  while (dir !== APP_DIR) {
    if (hasMetadata(path.join(dir, "layout.tsx"))) return true;
    dir = path.dirname(dir);
  }
  return false;
}

describe("page titles", () => {
  const pages = walk(APP_DIR).filter((f) => path.basename(f) === "page.tsx");

  it("finds the app's pages", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it("gives every page a title of its own", () => {
    const missing = pages
      .map((f) => path.relative(APP_DIR, f).split(path.sep).join("/"))
      .filter((rel) => !EXEMPT.has(rel))
      .filter((rel) => !covered(path.join(APP_DIR, rel)));
    expect(missing).toEqual([]);
  });

  it("keeps the root title template that appends the brand", () => {
    const root = readFileSync(path.join(APP_DIR, "layout.tsx"), "utf8");
    expect(root).toMatch(/template:\s*TITLE_TEMPLATE/);
    expect(TITLE_TEMPLATE).toBe("%s · Talib");
  });

  it("pageTitle titles its own segment and passes the template down", () => {
    expect(pageTitle("Siswa").title).toEqual({
      absolute: "Siswa · Talib",
      template: "%s · Talib",
    });
  });

  it("never uses a plain string title in a layout (it would drop the template for nested routes)", () => {
    const plain = walk(APP_DIR)
      .filter((f) => path.basename(f) === "layout.tsx" && path.dirname(f) !== APP_DIR)
      .filter((f) => /metadata[^=]*=\s*\{\s*title:\s*"/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(APP_DIR, f));
    expect(plain).toEqual([]);
  });
});
