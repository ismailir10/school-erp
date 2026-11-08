import type { ChangeAudience, Release } from "./schema";

export type ChangelogScope = "mine" | "all";

/** The portal a signed-in role lives in. Anything unknown sees everything. */
export function audienceForRole(role: string): ChangeAudience | null {
  if (role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN") return "admin";
  if (role === "TEACHER") return "guru";
  if (role === "GUARDIAN") return "orang-tua";
  return null;
}

/**
 * "mine" keeps the viewer's own items plus the ones for everyone; "all" keeps every item.
 * Releases left with no items are dropped, so the page never shows an empty card.
 */
export function filterReleases(
  releases: readonly Release[],
  audience: ChangeAudience | null,
  scope: ChangelogScope,
): Release[] {
  if (scope === "all" || audience === null) return [...releases];
  return releases
    .map((r) => ({ ...r, items: r.items.filter((it) => it.audience === audience || it.audience === "semua") }))
    .filter((r) => r.items.length > 0);
}
