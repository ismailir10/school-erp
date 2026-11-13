import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Focus-indicator guard. Keyboard focus uses one style, the `focus-outline`
 * utility in app/globals.css. Hand-rolled `focus-visible:ring-*` (or `focus:` /
 * `focus-within:`) drift from it, so they are rejected in app/ and components/.
 */

const ROOT = process.cwd();
const PATTERN = /\b(?:focus-visible|focus|focus-within):ring-/;

// "path:line" entries exempt from the rule. Keep empty; justify any addition.
const ALLOWLIST: string[] = [];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("focus indicator guard", () => {
  it("uses focus-visible:focus-outline instead of ring-* focus classes", () => {
    const offenders: string[] = [];
    for (const file of [...walk(join(ROOT, "app"), []), ...walk(join(ROOT, "components"), [])]) {
      const rel = relative(ROOT, file).split("\\").join("/");
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const id = `${rel}:${i + 1}`;
          if (PATTERN.test(line) && !ALLOWLIST.includes(id)) offenders.push(id);
        });
    }
    expect(
      offenders,
      `Use \`focus-visible:focus-outline\` (see .claude/standards/ui.md), not ring-* focus classes:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
