/**
 * Employee code (`Employee.kode`) generation — pure, so the route can recompute
 * it on a retry and tests can pin the sequence.
 *
 * Shape: `<INITIALS><n>`. `n` is one more than the highest numeric suffix among
 * the tenant's existing codes (one global sequence per tenant, NOT per initials
 * prefix) so it never repeats under the `@@unique([tenantId, kode])` index.
 *
 * Why not sort the codes: a string sort ranks "RE29" above "RD30" and "99"
 * above "100", which re-issued a taken code (STR-4, 2026-10-07).
 */

const MAX_INITIAL_WORDS = 2;
const FALLBACK_INITIAL = "X";

/**
 * First letter of up to two words, upper-cased. Walks code points
 * (`Array.from`), never UTF-16 units, so an emoji can't be split into a lone
 * surrogate; only Unicode letters count, so "😀 Emoji Guru" → "EG".
 *
 * Non-Latin letters are kept as-is (Arabic "محمد علي" → "مع"; upper-casing is a
 * no-op there). They are valid Postgres text and the only faithful initials
 * such a name has. A name with no letters at all falls back to "X".
 */
export function employeeInitials(name: string): string {
  const letters: string[] = [];
  for (const word of name.trim().split(/\s+/)) {
    const first = Array.from(word).find((ch) => /\p{L}/u.test(ch));
    if (!first) continue;
    // toUpperCase can expand ("ß" → "SS"); keep one code point per word.
    letters.push(Array.from(first.toUpperCase())[0]);
    if (letters.length === MAX_INITIAL_WORDS) break;
  }
  return letters.length > 0 ? letters.join("") : FALLBACK_INITIAL;
}

/** Highest trailing integer across the codes (0 when none carry one). BigInt: no float overflow on absurd suffixes. */
export function maxKodeNumber(existingKodes: Iterable<string>): bigint {
  let max = BigInt(0);
  for (const kode of existingKodes) {
    const digits = /(\d+)$/.exec(kode)?.[1];
    if (!digits) continue;
    const n = BigInt(digits);
    if (n > max) max = n;
  }
  return max;
}

export function nextEmployeeKode(name: string, existingKodes: Iterable<string>): string {
  return `${employeeInitials(name)}${maxKodeNumber(existingKodes) + BigInt(1)}`;
}

/**
 * True when a Prisma P2002 is the `(tenantId, kode)` collision. Prisma 7's
 * driver adapters report the target in different `meta` shapes (field list,
 * constraint name, nested adapter error), so match on the serialised error.
 */
export function isKodeCollision(e: unknown): boolean {
  if (typeof e !== "object" || e === null || (e as { code?: unknown }).code !== "P2002") return false;
  let haystack = String((e as { message?: unknown }).message ?? "");
  try {
    haystack += JSON.stringify((e as { meta?: unknown }).meta ?? {});
  } catch {
    // circular meta — message alone is enough
  }
  return /kode/i.test(haystack);
}
