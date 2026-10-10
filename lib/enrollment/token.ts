/**
 * Access-token util for enrollment applications. The token is emailed to the
 * parent and is the ONLY credential gating the public form route — so it must
 * be unguessable (256 bits of CSPRNG entropy) and non-enumerable. It is NOT
 * the row's cuid `id` (which is exposed in admin URLs and is not secret).
 */

import { randomBytes } from "crypto";

/** Default time-to-live for an invite token (cycle assumption 3). */
export const TOKEN_TTL_DAYS = 14;

/**
 * Generate a URL-safe 256-bit access token. base64url avoids `+`, `/`, and
 * `=` so the token drops straight into a path segment without encoding.
 */
export function generateAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Cheap shape check for a token taken from a URL, BEFORE it is used as a
 * rate-limit key or a lookup value. A real token is 43 base64url characters;
 * this accepts anything URL-safe up to 128, so it only rejects garbage (a
 * multi-KB path segment, odd characters) that must not occupy a limiter entry
 * per unique string. It says nothing about whether the token exists.
 */
export function isTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(token);
}

/** Expiry instant for a freshly minted token, `TOKEN_TTL_DAYS` from `now`. */
export function tokenExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** True when `expiresAt` is set and already in the past relative to `now`. */
export function isTokenExpired(
  expiresAt: Date | null | undefined,
  now: Date,
): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime();
}
