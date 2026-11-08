import type { ChangeAudience, ChangeModule, Release } from "./schema";

export type ChangelogScope = "mine" | "all";

export interface ChangelogFilters {
  month?: string;
  module?: ChangeModule;
}

const RELEASES_PER_PAGE = 5;

/** The portal a signed-in role lives in. Anything unknown sees everything. */
export function audienceForRole(role: string): ChangeAudience | null {
  if (role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN") return "admin";
  if (role === "TEACHER") return "guru";
  if (role === "GUARDIAN") return "orang-tua";
  return null;
}

export function releaseMonths(releases: readonly Release[]): string[] {
  return [...new Set(releases.map(({ id }) => id.slice(0, 7)))].sort().reverse();
}

/** Combine filters before dropping releases that have no visible items. */
export function filterReleases(
  releases: readonly Release[],
  audience: ChangeAudience | null,
  scope: ChangelogScope,
  { month, module }: ChangelogFilters = {},
): Release[] {
  const showAllAudiences = scope === "all" || audience === null;
  return releases
    .filter(({ id }) => !month || id.slice(0, 7) === month)
    .map((release) => ({
      ...release,
      items: release.items.filter(
        (item) =>
          (showAllAudiences || item.audience === audience || item.audience === "semua") &&
          (!module || item.module === module),
      ),
    }))
    .filter(({ items }) => items.length > 0);
}

export function paginateReleases(releases: readonly Release[], requestedPage: number) {
  const totalPages = Math.ceil(releases.length / RELEASES_PER_PAGE);
  const page = Math.min(Math.max(requestedPage, 1), Math.max(totalPages, 1));
  const start = (page - 1) * RELEASES_PER_PAGE;
  return { page, totalPages, releases: releases.slice(start, start + RELEASES_PER_PAGE) };
}
