import { ApiError, userMessage } from "@/lib/api/client-errors";

export type FieldErrors = Record<string, string>;

/**
 * Map a failed mutation to inline errors. Field errors land on their field,
 * a 409 lands on `conflictField`, anything else becomes the form-level `root`.
 */
export function toFieldErrors(err: unknown, fallback: string, conflictField = "name"): FieldErrors {
  if (err instanceof ApiError) {
    const out: FieldErrors = {};
    for (const fe of err.fieldErrors) out[fe.field || "root"] = fe.message;
    if (Object.keys(out).length > 0) return out;
    if (err.status === 409) return { [conflictField]: err.message };
  }
  return { root: userMessage(err, fallback) };
}
