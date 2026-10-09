import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `formatDate` / `formatDateShort` render a full ISO timestamp on the
 * Asia/Jakarta calendar day (lib/format.ts). Cutting the string first with
 * `.slice(0, 10)` or `.split("T")[0]` hands it the UTC date instead, so a
 * payment recorded at 05:00 WIB on 7 Okt reads "6 Oktober". This was the
 * parent-portal gap left open by the admin-dates-wib cycle; the scan keeps it
 * closed. Pass the raw timestamp — `formatDate` already does the right thing
 * for date-only and UTC-midnight values too.
 */

const ROOTS = ["app/parent", "components/parent"];

// formatDate( … <expr>.slice(0, 10) | .substring(0, 10) | .split("T")[0] …
// The argument list is matched lazily up to the first pre-truncation, with no
// nested call allowed in between so an unrelated later call cannot match.
const PRE_TRUNCATED =
  /formatDate(?:Short)?\(\s*[^()]*?\.(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\(\s*["']T["']\s*\)\s*\[\s*0\s*\])/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("parent portal never pre-truncates a timestamp before formatDate", () => {
  const cwd = process.cwd();
  const files = ROOTS.flatMap((root) => sourceFiles(join(cwd, root)));

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("finds no formatDate(x.slice(0, 10)) / formatDate(x.split('T')[0])", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(PRE_TRUNCATED)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${relative(cwd, file)}:${line}  ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the pattern does catch the shapes it is meant to", () => {
    const bad = [
      'formatDate(item.publishedAt.slice(0, 10), { day: "numeric" })',
      "formatDateShort(row.createdAt.split('T')[0])",
      "formatDate(\n  p.paidAt.slice(0,10),\n)",
      "formatDate(a.b.substring(0, 10))",
    ];
    for (const s of bad) expect(s.match(PRE_TRUNCATED)?.length ?? 0).toBe(1);
    const ok = [
      "formatDate(item.publishedAt, { day: 'numeric' })",
      "const overdue = invoice.dueDate.slice(0, 10) < today;",
      "formatDate(x); y.slice(0, 10)",
    ];
    for (const s of ok) expect(s.match(PRE_TRUNCATED)).toBeNull();
  });
});
