/**
 * Client-side error → user-facing message translation.
 *
 * Client components fetch JSON from our API routes and, on failure, need
 * to show the admin something readable. The naive `err instanceof Error
 * ? err.message : fallback` pattern is only safe when every `Error`
 * reaching the catch block was deliberately constructed with copy meant
 * for display. In practice it also catches `TypeError`s from a failed
 * `res.json()` call (e.g. a 500 with an empty body), network failures,
 * and anything else the runtime or a library throws — all of which leak
 * raw exception text (`"Unexpected end of JSON input"`, etc.) straight
 * into the UI.
 *
 * `ApiError` marks a message as author-approved for display. Throw it
 * (never a plain `Error`) at the point client code reads an API error
 * envelope — `if (!res.ok) throw new ApiError(body.error ?? "<Indonesian
 * fallback>")` — or otherwise deliberately writes a message meant for a
 * user. `userMessage()` then passes that message through and falls back
 * to the caller-supplied copy for every other error shape.
 */
export type ApiFieldError = { field: string; message: string };

export class ApiError extends Error {
  /** Per-field messages from a `validateBody` 400 (`errors[]`); empty otherwise. */
  readonly fieldErrors: ApiFieldError[];
  readonly status?: number;

  constructor(message: string, options: { fieldErrors?: ApiFieldError[]; status?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.fieldErrors = options.fieldErrors ?? [];
    this.status = options.status;
  }
}

function isFieldError(value: unknown): value is ApiFieldError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiFieldError).field === "string" &&
    typeof (value as ApiFieldError).message === "string"
  );
}

/**
 * Auth and server failures often arrive as a bare machine word ("Forbidden",
 * "Unauthorized") or the stock English "Internal Server Error". Prose with a
 * space is a real Indonesian server message and is kept; a missing or
 * single-word body is replaced with approved copy. Same "must contain a space"
 * heuristic as `lib/teacher/fetch-error-copy.ts`. A 5xx with no body at all
 * keeps the caller's own Indonesian fallback (it names the action that failed);
 * the generic server copy only fills in when that fallback is empty.
 */
function statusCopy(status: number, serverText: string, fallback: string): string | null {
  const readable = serverText.includes(" ");
  if (status === 403 && !readable) return "Anda tidak memiliki izin untuk tindakan ini.";
  if (status === 401 && !readable) return "Sesi Anda berakhir. Silakan masuk kembali.";
  if (status >= 500) {
    const stock = serverText.toLowerCase() === "internal server error";
    if (serverText && (!readable || stock)) return "Terjadi kendala di server. Coba lagi sebentar lagi.";
    if (!serverText && !fallback.trim()) return "Terjadi kendala di server. Coba lagi sebentar lagi.";
  }
  return null;
}

/**
 * Build an `ApiError` from a failed response's standard envelope
 * `{ error, errors?: [{ field, message }] }`. A body that is missing, not
 * JSON, or has no `error` string falls back to `fallback` — except
 * 401/403 and machine-word / stock-English 5xx text, which map to fixed
 * Indonesian copy (see `statusCopy`).
 */
export async function readApiError(res: Response, fallback: string): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const envelope = (typeof body === "object" && body !== null ? body : {}) as {
    error?: unknown;
    errors?: unknown;
  };
  const serverText = typeof envelope.error === "string" ? envelope.error.trim() : "";
  const message = statusCopy(res.status, serverText, fallback) ?? (serverText || fallback);
  const fieldErrors = Array.isArray(envelope.errors) ? envelope.errors.filter(isFieldError) : [];
  return new ApiError(message, { fieldErrors, status: res.status });
}

/**
 * Resolve a user-facing error message for a catch block.
 *
 * Returns `err.message` only when `err` is an `ApiError`. Every other
 * error — parse errors, network errors, `TypeError`s, anything else
 * thrown by the runtime or a library — falls back to `fallback`. The
 * raw error is always logged so debuggability isn't lost.
 */
export function userMessage(err: unknown, fallback: string): string {
  console.error(err);
  return err instanceof ApiError ? err.message : fallback;
}
