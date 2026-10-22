import { timingSafeEqual } from "crypto";

/**
 * Constant-time check of an `Authorization: Bearer <secret>` header.
 *
 * Fail-closed: an unset/empty `expected` secret or a missing header never
 * matches. The length check comes first because `timingSafeEqual` throws on
 * unequal lengths; it leaks only the secret's length, not its content.
 */
export function bearerMatches(
  authHeader: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || !authHeader) return false;
  const given = Buffer.from(authHeader);
  const want = Buffer.from(`Bearer ${expected}`);
  return given.length === want.length && timingSafeEqual(given, want);
}
