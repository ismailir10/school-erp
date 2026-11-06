/**
 * Theme-name matching for curriculum imports.
 *
 * PROMES workbooks carry theme names as column headers (cols E+); the
 * semester calendar carries the same names as `Theme.name` rows. The two
 * are authored by hand in separate files, so they drift on whitespace and
 * capitalisation but not on wording.
 *
 * Matching is **normalise-then-exact**, never fuzzy. A fuzzy match that
 * picks the wrong theme silently mis-links an IKTP, and the walas weekly
 * picker (`lib/curriculum/weekly-assessment-loader.ts`) filters purely on
 * theme link — so a wrong link surfaces as "the wrong indicators showed
 * up this pekan", which nobody reports as a bug. Unmatched names are
 * returned to the caller for the admin to fix instead.
 */

/**
 * Trim → collapse internal whitespace → casefold.
 *
 * Deliberately does NOT strip punctuation: "Aku Sayang Bumi" and
 * "Aku, Sayang Bumi" are different themes as far as we can tell, and
 * guessing is worse than reporting.
 */
export function normaliseThemeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface ThemeRef {
  id: string;
  name: string;
  /** A / B / null (shared). Optional for callers that do not scope by kelompok. */
  ageGroup?: "A" | "B" | null;
}

export interface ThemeMatchResult {
  /** Normalised name → theme id. First occurrence wins on duplicates. */
  idByNormalisedName: Map<string, string>;
  /**
   * Themes whose normalised name collides with an earlier row. Duplicate
   * theme names inside one semester are a data error the admin should fix;
   * we surface them rather than silently picking one.
   */
  duplicateNames: string[];
}

/**
 * Index a semester's themes for lookup.
 *
 * With `ageGroup`, only themes visible to that kelompok (same group or shared)
 * are indexed, and a group-specific theme beats a shared one of the same name.
 * Themes of the other kelompok are skipped, so their names stay unmatched.
 */
export function indexThemes(
  allThemes: ThemeRef[],
  ageGroup?: "A" | "B",
): ThemeMatchResult {
  const idByNormalisedName = new Map<string, string>();
  const duplicateNames: string[] = [];
  const themes = ageGroup
    ? allThemes
        .filter((t) => t.ageGroup == null || t.ageGroup === ageGroup)
        // group-specific first so it wins the "first occurrence" rule
        .sort((a, b) => Number(a.ageGroup == null) - Number(b.ageGroup == null))
    : allThemes;
  const specificKeys = new Set<string>();
  for (const theme of themes) {
    const key = normaliseThemeName(theme.name);
    if (!key) continue;
    if (ageGroup && theme.ageGroup != null) specificKeys.add(key);
    if (idByNormalisedName.has(key)) {
      // A shared theme shadowed by a group-specific one is intended, not a data error.
      if (ageGroup && theme.ageGroup == null && specificKeys.has(key)) continue;
      if (!duplicateNames.includes(theme.name)) duplicateNames.push(theme.name);
      continue;
    }
    idByNormalisedName.set(key, theme.id);
  }
  return { idByNormalisedName, duplicateNames };
}

export interface ResolvedThemeNames {
  /** Theme ids resolved from the input names, de-duplicated, input order. */
  themeIds: string[];
  /** Input names with no matching theme, de-duplicated, input order. */
  unmatched: string[];
}

/**
 * Resolve a batch of raw theme names against an indexed semester.
 * Pure — no DB access, no throwing.
 */
export function resolveThemeNames(
  names: string[],
  index: ThemeMatchResult,
): ResolvedThemeNames {
  const themeIds: string[] = [];
  const unmatched: string[] = [];
  // De-dup unmatched on the NORMALISED key, not the raw text, so a file
  // that spells the same missing theme two ways ("Kendaraan" in one
  // column header, "KENDARAAN" in another) reports it once. The first
  // spelling seen is what the admin gets shown.
  const seenUnmatched = new Set<string>();
  for (const raw of names) {
    const key = normaliseThemeName(raw);
    if (!key) continue;
    const id = index.idByNormalisedName.get(key);
    if (id) {
      if (!themeIds.includes(id)) themeIds.push(id);
    } else if (!seenUnmatched.has(key)) {
      seenUnmatched.add(key);
      unmatched.push(raw.trim());
    }
  }
  return { themeIds, unmatched };
}
