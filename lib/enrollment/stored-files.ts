/**
 * Storage-object lifecycle helpers shared by the public enrollment upload
 * routes (signatures and documents).
 *
 * Every upload gets a UNIQUE storage path (`randomSegment()` in the `field`),
 * so a token that has been deleted can never be written onto the row again.
 * That is what makes "re-read the row, delete if unreferenced" race-free: no
 * concurrent request can re-reference an object we are about to remove,
 * because only the request that created an object ever holds its token.
 *
 * Server-only (Prisma + storage).
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Short `[a-zA-Z0-9]` id from a CSPRNG; safe as a storage `field` segment. */
export function randomSegment(length = 10): string {
  // Rejection sampling keeps the distribution uniform (62 does not divide 256).
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

/** Best-effort delete: a leaked object is harmless, a failed cleanup must not fail the request. */
export async function deleteQuietly(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try {
    await deleteFile(token);
  } catch {
    /* ignore */
  }
}

/** True when any `{ <field>: token }` one level inside the JSON column's keys equals `token`. */
function referencesToken(column: unknown, token: string): boolean {
  if (!column || typeof column !== "object" || Array.isArray(column)) return false;
  return Object.values(column as Record<string, unknown>).some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const e = entry as Record<string, unknown>;
    return e.fileToken === token || e.signatureToken === token;
  });
}

/**
 * Delete `token` only if the row's `column` no longer references it under ANY
 * key. Read AFTER the write that replaced/removed the reference.
 */
export async function discardIfUnreferenced(
  id: string,
  column: "consentData" | "documents",
  token: string | null | undefined,
): Promise<void> {
  if (!token) return;
  try {
    const row = await prisma.enrollmentApplication.findUnique({ where: { id }, select: { [column]: true } });
    if (referencesToken((row as Record<string, unknown> | null)?.[column], token)) return;
    await deleteFile(token);
  } catch {
    /* ignore */
  }
}
