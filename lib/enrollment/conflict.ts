/**
 * Which kind of 409 a public token route answered, for the parent's browser.
 * The routes use 409 for two different things — `ALREADY_SUBMITTED` (the formulir
 * is closed) and `PAYMENT_REQUIRED` (pay-first: the fee is still owed) — and the
 * form has to tell them apart. Client-safe: no Prisma, no Next server imports.
 */
export type TokenConflict = "PAYMENT_REQUIRED" | "ALREADY_SUBMITTED";

/** The conflict kind of a 409 response, or null for any other status or an unreadable body. */
export async function readConflict(res: Pick<Response, "status" | "json">): Promise<TokenConflict | null> {
  if (res.status !== 409) return null;
  let body: { error?: unknown } | null = null;
  try {
    body = (await res.json()) as { error?: unknown } | null;
  } catch {
    // Unreadable body: treat as the closed-form 409, today's behaviour.
  }
  return body?.error === "PAYMENT_REQUIRED" ? "PAYMENT_REQUIRED" : "ALREADY_SUBMITTED";
}
