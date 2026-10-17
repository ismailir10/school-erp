import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Vercel Cron invokes each `vercel.json` `crons[].path` with an HTTP GET.
 * A route that exports only POST answers 405 before any of our code runs, and
 * a handler test that calls `POST(req)` directly stays green. Both nightly
 * jobs were POST-only until cycle 2026-10-16-cron-get-handlers.
 * This ties the config to the code so a new cron cannot repeat it.
 */

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/payments/reconcile", () => ({}));

const repoRoot = join(__dirname, "..", "..", "..");
const crons: { path: string }[] =
  JSON.parse(readFileSync(join(repoRoot, "vercel.json"), "utf8")).crons ?? [];

describe("vercel.json crons", () => {
  it("declares at least one cron", () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it.each(crons.map((c) => c.path))("%s exports a GET handler", async (path) => {
    // Route files live at app/<cron path>/route.ts.
    const mod = await import(/* @vite-ignore */ pathToFileURL(join(repoRoot, "app", path, "route.ts")).href);
    expect(typeof mod.GET).toBe("function");
  });
});
