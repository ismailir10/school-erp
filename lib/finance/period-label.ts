/**
 * Period-label normalisation for the billing "already invoiced this period"
 * guard (FINX-6, docs/cycles/2026-10-07-finance-money-guards.md).
 *
 * `Invoice.periodLabel` is free text, so `Oktober 2026`, `oktober 2026` and
 * `Okt 2026` are the same period to a school but three different strings to
 * an exact-match query — a second run would double-bill every student. The
 * label is stored exactly as typed; only the COMPARISON goes through
 * `normalizePeriodLabel`.
 *
 * Pure and Prisma-free: the wizard (client) also imports it to derive the
 * default due date from the typed period.
 */

const MONTH_NAMES = [
  "januari",
  "februari",
  "maret",
  "april",
  "mei",
  "juni",
  "juli",
  "agustus",
  "september",
  "oktober",
  "november",
  "desember",
] as const;

// Every accepted spelling → canonical full month name. Indonesian short forms
// are not standardised ("agu"/"agt"/"ags", "nov"/"nop", "sep"/"sept"), so
// accept the ones people actually type.
const MONTH_ALIASES: Record<string, (typeof MONTH_NAMES)[number]> = {
  jan: "januari",
  januari: "januari",
  feb: "februari",
  februari: "februari",
  mar: "maret",
  maret: "maret",
  apr: "april",
  april: "april",
  mei: "mei",
  jun: "juni",
  juni: "juni",
  jul: "juli",
  juli: "juli",
  agu: "agustus",
  agt: "agustus",
  ags: "agustus",
  agus: "agustus",
  agustus: "agustus",
  sep: "september",
  sept: "september",
  september: "september",
  okt: "oktober",
  oktober: "oktober",
  nov: "november",
  nop: "november",
  november: "november",
  des: "desember",
  desember: "desember",
};

/**
 * Lower-case, trim, collapse whitespace, and rewrite any Indonesian month
 * abbreviation/alias to the full month name; the year (and any other text)
 * is kept. A label with no recognisable month ("Semester 1 2025/2026")
 * comes back as just its lower-cased, whitespace-collapsed self.
 */
export function normalizePeriodLabel(label: string): string {
  const collapsed = label.toLowerCase().replace(/\s+/g, " ").trim();
  // Whole letter-runs only (optionally followed by an abbreviation dot), so
  // "mar" inside another word is never rewritten.
  return collapsed.replace(/\p{L}+\.?/gu, (token) => {
    const word = token.endsWith(".") ? token.slice(0, -1) : token;
    return MONTH_ALIASES[word] ?? token;
  });
}

/**
 * Month + year a period label refers to, or `null` when it does not name
 * exactly one month and one year ("Semester 1 2025/2026", "Okt - Des 2026",
 * "Oktober"). `month` is 1-12.
 */
export function parsePeriodMonth(label: string): { year: number; month: number } | null {
  const normalized = normalizePeriodLabel(label);
  const months = new Set<number>();
  for (const word of normalized.match(/\p{L}+/gu) ?? []) {
    const idx = MONTH_NAMES.indexOf(word as (typeof MONTH_NAMES)[number]);
    if (idx !== -1) months.add(idx + 1);
  }
  const years = new Set(normalized.match(/\b(?:19|20)\d{2}\b/g) ?? []);
  if (months.size !== 1 || years.size !== 1) return null;
  return { year: Number([...years][0]), month: [...months][0] };
}
