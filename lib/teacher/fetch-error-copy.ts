/**
 * Teacher-portal fetch failures → Indonesian copy + what the UI may offer.
 *
 * Raw API text ("Unauthorized"), browser text ("Failed to fetch") and status
 * codes are log-only (voice.md, "Never render a caught error"). A 401 or 403
 * can never succeed on retry, so those kinds tell the UI not to offer
 * "Coba lagi"; a 401 should offer a sign-in link instead.
 */
export type FetchFailureKind = "auth" | "forbidden" | "network" | "server" | "validation";

export type FetchFailure = {
  message: string;
  kind: FetchFailureKind;
  canRetry: boolean;
};

export type FetchFailureInput = {
  /** HTTP status of the response, when one arrived. */
  status?: number;
  /** The request never got a response (fetch threw — offline, DNS, aborted). */
  networkError?: boolean;
  /** Past participle of what failed, e.g. "disimpan" or "dimuat". */
  action: string;
  /** The API's own `error` text. Used only for 400/409/422, and only when sane. */
  serverMessage?: string;
};

const MAX_SERVER_MESSAGE = 160;

export function describeFetchFailure({ status, networkError, action, serverMessage }: FetchFailureInput): FetchFailure {
  if (networkError) {
    return { kind: "network", canRetry: true, message: "Koneksi terputus. Periksa internet, lalu coba lagi." };
  }
  if (status === 401) {
    return { kind: "auth", canRetry: false, message: "Sesi Anda sudah berakhir. Masuk lagi, lalu simpan ulang." };
  }
  if (status === 403) {
    return { kind: "forbidden", canRetry: false, message: "Anda tidak punya akses ke kelas ini. Hubungi admin sekolah." };
  }
  if (status === 429) {
    return { kind: "server", canRetry: true, message: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi." };
  }
  if (status === 400 || status === 409 || status === 422 || status === 404) {
    const trimmed = serverMessage?.trim();
    // A machine code ("student_not_enrolled") is not a sentence; only prose
    // with a space in it can be shown to a teacher.
    const usable =
      status !== 404 && trimmed && trimmed.includes(" ") && trimmed.length <= MAX_SERVER_MESSAGE ? trimmed : null;
    return { kind: "validation", canRetry: true, message: usable ?? `Data belum bisa ${action}. Coba lagi.` };
  }
  return { kind: "server", canRetry: true, message: "Server sedang bermasalah. Coba lagi sebentar lagi." };
}

/** Throwable carrier so a `catch` can tell a described failure from anything else. */
export class FetchFailureError extends Error {
  readonly failure: FetchFailure;
  constructor(failure: FetchFailure) {
    super(failure.message);
    this.name = "FetchFailureError";
    this.failure = failure;
  }
}

/**
 * `fetch` that only ever rejects with a `FetchFailureError`: a thrown fetch
 * becomes a network failure, a non-2xx response is described by its status.
 */
export async function fetchOrDescribe(input: RequestInfo | URL, init: RequestInit | undefined, action: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new FetchFailureError(describeFetchFailure({ networkError: true, action }));
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    // Routes that pair a code with prose put the prose in `message`.
    const fields = typeof body === "object" && body !== null ? (body as { error?: unknown; message?: unknown }) : {};
    const serverMessage =
      typeof fields.message === "string" ? fields.message : typeof fields.error === "string" ? fields.error : undefined;
    throw new FetchFailureError(describeFetchFailure({ status: response.status, action, serverMessage }));
  }
  return response;
}

/** Catch-block helper: any thrown value → a safe, described failure. */
export function failureFromError(error: unknown, action: string): FetchFailure {
  return error instanceof FetchFailureError ? error.failure : describeFetchFailure({ action });
}
