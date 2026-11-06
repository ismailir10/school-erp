import type { AgeGroup, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findWeekOverlap, type WeekDateRange } from "@/lib/validations/curriculum";

/**
 * Theme kelompok scope (cycle 2026-11-06-theme-age-group).
 *
 * `Theme.ageGroup` is A, B, or null (shared by both groups, e.g. MPLS).
 * A class of kelompok X sees themes where ageGroup = X or ageGroup IS NULL.
 */
export type ThemeAgeGroup = AgeGroup | null;

export const AGE_GROUP_LABEL: Record<AgeGroup, string> = { A: "TK A", B: "TK B" };

export function themeScopeLabel(ageGroup: ThemeAgeGroup): string {
  return ageGroup ? AGE_GROUP_LABEL[ageGroup] : "Semua kelompok";
}

/** Prisma `where` for themes visible to a class of the given kelompok. */
export function themesVisibleTo(ageGroup: AgeGroup): Prisma.ThemeWhereInput {
  return { OR: [{ ageGroup }, { ageGroup: null }] };
}

/** True when a class of kelompok `classGroup` can see a theme scoped `themeGroup`. */
export function themeVisibleTo(themeGroup: ThemeAgeGroup, classGroup: AgeGroup): boolean {
  return themeGroup === null || themeGroup === classGroup;
}

/**
 * True when two theme scopes are seen together by at least one kelompok,
 * so their weeks must not overlap. Only TK A vs TK B is disjoint.
 */
export function scopesShareViewers(a: ThemeAgeGroup, b: ThemeAgeGroup): boolean {
  return a === null || b === null || a === b;
}

/** Prisma `where` for themes whose scope shares viewers with `ageGroup`. */
export function themesSharingViewersWith(ageGroup: ThemeAgeGroup): Prisma.ThemeWhereInput {
  return ageGroup === null ? {} : themesVisibleTo(ageGroup);
}

/**
 * Find an ACTIVE week in the same semester, under a theme whose scope shares
 * viewers with `ageGroup`, that overlaps the candidate range. Weeks listed in
 * `excludeWeekIds` (the candidate itself, or the theme being re-scoped) are
 * skipped. Returns the conflicting week or null.
 */
export async function findScopedWeekOverlap(params: {
  tenantId: string;
  semesterId: string;
  ageGroup: ThemeAgeGroup;
  candidates: Array<{ id?: string; startDate: string | Date; endDate: string | Date }>;
  excludeWeekIds?: string[];
  excludeThemeId?: string;
}): Promise<WeekDateRange | null> {
  const { tenantId, semesterId, ageGroup, candidates, excludeWeekIds = [], excludeThemeId } = params;
  if (candidates.length === 0) return null;
  const existing = await prisma.week.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      ...(excludeWeekIds.length > 0 ? { id: { notIn: excludeWeekIds } } : {}),
      subTheme: {
        status: "ACTIVE",
        theme: {
          semesterId,
          status: "ACTIVE",
          ...(excludeThemeId ? { id: { not: excludeThemeId } } : {}),
          ...themesSharingViewersWith(ageGroup),
        },
      },
    },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  for (const c of candidates) {
    const hit = findWeekOverlap(existing, c);
    if (hit) return hit;
  }
  return null;
}

